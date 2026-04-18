import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { TimeWindowConfig } from '../config/configuration.types';

export interface TimeWindowBlockerProps {
  /** Time window configuration (timezone, blocked hours, holidays) */
  readonly timeWindowConfig: TimeWindowConfig;
}

/**
 * CDK construct that creates a Lambda-backed deployment time window blocker.
 *
 * The construct provisions a Node.js Lambda function that evaluates whether
 * the current time falls within an allowed deployment window. It exposes a
 * `pipelines.CodeBuildStep` that invokes the Lambda via the AWS CLI and
 * exits non-zero when deployments are blocked, causing the pipeline to halt.
 *
 * Usage in PipelineStack:
 * ```ts
 * const blocker = new TimeWindowBlocker(this, 'TimeWindowBlocker', {
 *   timeWindowConfig: config.timeWindow,
 * });
 *
 * // Add as pre-deployment step before Prod stage
 * pipeline.addStage(prodStage, {
 *   pre: [blocker.step, new pipelines.ManualApprovalStep('PromoteToProd')],
 * });
 * ```
 */
export class TimeWindowBlocker extends Construct {
  /** The Lambda function that evaluates the deployment window */
  public readonly function: lambda.Function;

  /** The pipeline step that invokes the Lambda and blocks if outside the window */
  public readonly step: pipelines.CodeBuildStep;

  constructor(scope: Construct, id: string, props: TimeWindowBlockerProps) {
    super(scope, id);

    const { timeWindowConfig } = props;

    // Create the Lambda function that evaluates the time window
    this.function = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/time-window-blocker'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      description: 'Evaluates whether the current time is within the allowed deployment window',
      environment: {
        TIMEZONE: timeWindowConfig.timezone,
        BLOCKED_HOUR_START: timeWindowConfig.blockedHourStart.toString(),
        BLOCKED_HOUR_END: timeWindowConfig.blockedHourEnd.toString(),
        HOLIDAYS: JSON.stringify(timeWindowConfig.holidays),
      },
    });

    // Create a CodeBuild step that invokes the Lambda via AWS CLI.
    // If the Lambda returns allowed: false, the step exits non-zero,
    // blocking the pipeline at this point.
    //
    // Note: CodeBuildStep.project is only available after the pipeline is built,
    // so we use rolePolicyStatements to grant Lambda invoke permissions inline.
    this.step = new pipelines.CodeBuildStep('TimeWindowCheck', {
      commands: [
        // Invoke the Lambda and capture the response
        `aws lambda invoke --function-name ${this.function.functionName} --payload '{}' /tmp/response.json --cli-binary-format raw-in-base64-out`,
        'cat /tmp/response.json',
        // Parse the response and check if deployment is allowed
        'ALLOWED=$(python3 -c "import json; r=json.load(open(\'/tmp/response.json\')); body=json.loads(r[\'body\']) if isinstance(r.get(\'body\'), str) else r; print(body[\'allowed\'])")',
        'echo "Deployment allowed: $ALLOWED"',
        'if [ "$ALLOWED" = "False" ] || [ "$ALLOWED" = "false" ]; then echo "Deployment blocked by time window policy"; exit 1; fi',
      ],
      rolePolicyStatements: [
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [this.function.functionArn],
        }),
      ],
    });
  }
}
