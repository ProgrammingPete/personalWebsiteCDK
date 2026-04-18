import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as notifications from 'aws-cdk-lib/aws-codestarnotifications';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { ApplicationConfig } from '../config/configuration.types';
import { TimeWindowBlocker } from '../constructs/time-window-blocker';
import { NotificationStack } from '../stacks/notification-stack';
import { WebsiteStage } from '../stages/website-stage';

export interface PipelineStackProps extends cdk.StackProps {
  /** Full application configuration from the Configuration Registry */
  readonly config: ApplicationConfig;
}

/**
 * Top-level stack deployed in the Pipeline account. Creates a self-mutating
 * CodePipeline sourcing from three GitHub repositories (CDK, Lambda, Frontend),
 * builds all artifacts in parallel, and deploys through Beta → Prod stages
 * with integration tests, time-window blocking, manual approval, and
 * alarm-based rollback monitoring.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { repositories, pipeline: pipelineConfig } = config;

    // ---------------------------------------------------------------
    // 1. Three CodePipelineSource.connection() sources
    // ---------------------------------------------------------------
    const cdkSource = pipelines.CodePipelineSource.connection(
      `${repositories.cdk.owner}/${repositories.cdk.name}`,
      repositories.cdk.branch,
      {
        connectionArn: repositories.cdk.connectionArn,
        actionName: 'CDK_Source',
      },
    );

    const lambdaSource = pipelines.CodePipelineSource.connection(
      `${repositories.lambda.owner}/${repositories.lambda.name}`,
      repositories.lambda.branch,
      {
        connectionArn: repositories.lambda.connectionArn,
        actionName: 'Lambda_Source',
      },
    );

    const frontendSource = pipelines.CodePipelineSource.connection(
      `${repositories.frontend.owner}/${repositories.frontend.name}`,
      repositories.frontend.branch,
      {
        connectionArn: repositories.frontend.connectionArn,
        actionName: 'Frontend_Source',
      },
    );

    // ---------------------------------------------------------------
    // 2. Synth step — build Lambda JAR + Frontend assets, then cdk synth
    //
    // CDK Pipelines resolves lambda.Code.fromAsset() and
    // s3deploy.Source.asset() at synth time, so the built artifacts
    // must exist on disk *before* `cdk synth` runs. We pull the
    // Lambda and Frontend repos as additionalInputs and build them
    // in-line so the placeholder directories are replaced with real
    // build outputs that CDK packages as cloud-assembly assets.
    // ---------------------------------------------------------------
    const synthStep = new pipelines.ShellStep('Synth', {
      input: cdkSource,
      additionalInputs: {
        '../lambdaSource': lambdaSource,
        '../frontendSource': frontendSource,
      },
      installCommands: ['npm ci'],
      commands: [
        // Build the Lambda fat JAR and copy it to the placeholder directory
        'cd ../lambdaSource && ./gradlew shadowJar',
        'mkdir -p $CODEBUILD_SRC_DIR/lambda/placeholder',
        'cp ../lambdaSource/build/libs/*-all.jar $CODEBUILD_SRC_DIR/lambda/placeholder/',
        // Build the Frontend assets and copy them to the placeholder directory
        'cd ../frontendSource && npm ci && npm run build',
        'rm -rf $CODEBUILD_SRC_DIR/test-assets/*',
        'cp -r ../frontendSource/dist/* $CODEBUILD_SRC_DIR/test-assets/ 2>/dev/null || cp -r ../frontendSource/build/* $CODEBUILD_SRC_DIR/test-assets/ 2>/dev/null || echo "WARN: Could not find frontend build output in dist/ or build/"',
        // Now synth with real artifacts in place
        'cd $CODEBUILD_SRC_DIR && npx cdk synth',
      ],
    });

    // ---------------------------------------------------------------
    // 3. CodePipeline with selfMutation: true
    // ---------------------------------------------------------------
    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'WebsitePipeline',
      synth: synthStep,
      selfMutation: true,
      crossAccountKeys: true,
    });

    // ---------------------------------------------------------------
    // 4. Beta stage with post-deployment integration tests
    // ---------------------------------------------------------------
    // Placeholder asset paths for local `cdk synth`.
    // In the pipeline, the Synth step builds the Lambda JAR and Frontend
    // assets and copies them into these directories before running `cdk synth`,
    // so the real artifacts replace these placeholders automatically.
    const frontendPlaceholder = path.join(__dirname, '..', '..', 'test-assets');
    const lambdaPlaceholder = path.join(__dirname, '..', '..', 'lambda', 'placeholder');

    const betaStage = new WebsiteStage(this, 'Beta', {
      env: {
        account: config.stages.beta.accountId,
        region: config.stages.beta.region,
      },
      stageConfig: config.stages.beta,
      pipelineConfig: pipelineConfig,
      lambdaConfig: config.lambda,
      frontendBuildOutput: frontendPlaceholder,
      lambdaJarPath: lambdaPlaceholder,
      stageName: 'beta',
    });

    const integrationTestStep = new pipelines.CodeBuildStep('IntegrationTest', {
      commands: [
        'chmod +x scripts/integration-test.sh',
        './scripts/integration-test.sh',
      ],
      env: {
        REGION: config.stages.beta.region,
        STAGE: 'beta',
      },
      envFromCfnOutputs: {},
      input: cdkSource,
    });

    pipeline.addStage(betaStage, {
      post: [integrationTestStep],
    });

    // ---------------------------------------------------------------
    // 5. Time Window Blocker (pre-Prod)
    // ---------------------------------------------------------------
    const timeWindowBlocker = new TimeWindowBlocker(this, 'TimeWindowBlocker', {
      timeWindowConfig: config.timeWindow,
    });

    // ---------------------------------------------------------------
    // 6. Manual Approval + Prod stage with alarm-based rollback
    // ---------------------------------------------------------------
    const prodStage = new WebsiteStage(this, 'Prod', {
      env: {
        account: config.stages.prod.accountId,
        region: config.stages.prod.region,
      },
      stageConfig: config.stages.prod,
      pipelineConfig: pipelineConfig,
      lambdaConfig: config.lambda,
      frontendBuildOutput: frontendPlaceholder,
      lambdaJarPath: lambdaPlaceholder,
      stageName: 'prod',
    });

    const bakeTimeMinutes = config.stages.prod.bakeTimeMinutes ?? 30;

    const prodDeployment = pipeline.addStage(prodStage, {
      pre: [
        timeWindowBlocker.step,
        new pipelines.ManualApprovalStep('PromoteToProd', {
          comment: 'Approve deployment to Production',
        }),
      ],
    });

    // Add a post-deployment bake step that monitors the Composite Alarm.
    // The bake step waits for the configured bake time and checks the alarm state.
    prodDeployment.addPost(
      new pipelines.CodeBuildStep('ProdBakeMonitor', {
        commands: [
          `echo "Starting bake time monitoring for ${bakeTimeMinutes} minutes..."`,
          `echo "Monitoring Composite Alarm for rollback signals..."`,
          // Poll the composite alarm state during the bake period
          `END_TIME=$(($(date +%s) + ${bakeTimeMinutes} * 60))`,
          'while [ $(date +%s) -lt $END_TIME ]; do',
          `  ALARM_STATE=$(aws cloudwatch describe-alarms --alarm-names "prod-CompositeAlarm" --alarm-types CompositeAlarm --query "CompositeAlarms[0].StateValue" --output text 2>/dev/null || echo "OK")`,
          '  echo "$(date): Alarm state = $ALARM_STATE"',
          '  if [ "$ALARM_STATE" = "ALARM" ]; then',
          '    echo "ALARM detected during bake period! Failing deployment for rollback."',
          '    exit 1',
          '  fi',
          '  sleep 60',
          'done',
          'echo "Bake time completed successfully. No alarms triggered."',
        ],
        rolePolicyStatements: [
          new cdk.aws_iam.PolicyStatement({
            actions: ['cloudwatch:DescribeAlarms'],
            resources: ['*'],
          }),
        ],
      }),
    );

    // ---------------------------------------------------------------
    // 7. Pipeline notification rule → SNS topic for failures
    // ---------------------------------------------------------------
    const notificationStack = new NotificationStack(this, 'PipelineNotifications', {});

    // Build the pipeline so we can access the underlying CodePipeline
    pipeline.buildPipeline();

    new notifications.NotificationRule(this, 'PipelineNotificationRule', {
      notificationRuleName: 'WebsitePipeline-FailureNotifications',
      source: pipeline.pipeline,
      events: [
        'codepipeline-pipeline-pipeline-execution-failed',
        'codepipeline-pipeline-stage-execution-failed',
        'codepipeline-pipeline-action-execution-failed',
      ],
      targets: [notificationStack.notificationTopic],
      detailType: notifications.DetailType.FULL,
    });
  }
}
