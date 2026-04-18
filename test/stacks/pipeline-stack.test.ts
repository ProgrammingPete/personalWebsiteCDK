import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PipelineStack } from '../../lib/pipeline/pipeline-stack';
import { config } from '../../lib/config/configuration';

/**
 * CDK assertion tests for PipelineStack.
 *
 * Validates: Three CodePipeline source actions (CDK, Lambda, Frontend),
 * synth step commands (including Lambda Gradle build and Frontend npm build),
 * selfMutation enabled, Beta and Prod stages present, manual approval before
 * Prod, pipeline notification rule to SNS, and BUILD_GENERAL1_SMALL compute type.
 *
 * Note: Lambda and Frontend builds run inside the Synth step so that the
 * built artifacts are available when `cdk synth` packages them as CDK assets.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.5, 3a.5, 6.1, 6.2,
 *               6.3, 22.3, 22.6, 23.1, 23.2
 *
 * NOTE: The PipelineStack synthesizes two full WebsiteStages (Beta + Prod),
 * each containing 6 nested stacks. To keep tests fast we synthesize the
 * template ONCE and share it across all assertions.
 */

// ---------------------------------------------------------------------------
// Shared fixture — synthesize once, reuse everywhere
// ---------------------------------------------------------------------------

let template: Template;
let pipelineStages: any[];

beforeAll(() => {
  const app = new cdk.App();

  const stack = new PipelineStack(app, 'TestPipelineStack', {
    env: {
      account: config.pipeline.pipelineAccountId,
      region: config.pipeline.pipelineRegion,
    },
    config,
  });

  template = Template.fromStack(stack);

  // Extract the Stages array from the main CodePipeline resource
  const pipelines = template.findResources('AWS::CodePipeline::Pipeline');
  const pipelineLogicalIds = Object.keys(pipelines);
  let mainPipeline: any = null;
  let maxStages = 0;
  for (const id of pipelineLogicalIds) {
    const stages = pipelines[id].Properties?.Stages ?? [];
    if (stages.length > maxStages) {
      maxStages = stages.length;
      mainPipeline = pipelines[id];
    }
  }
  pipelineStages = mainPipeline?.Properties?.Stages ?? [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findStage(name: string): any | undefined {
  return pipelineStages.find((s: any) => s.Name === name);
}

function findStageContaining(substring: string): any | undefined {
  return pipelineStages.find((s: any) =>
    s.Name?.includes(substring),
  );
}

// ---------------------------------------------------------------------------
// Source Actions tests (Requirements 1.2, 2.1, 2.2)
// ---------------------------------------------------------------------------

describe('CodePipeline Source Actions', () => {
  test('creates three CodeStarSourceConnection source actions', () => {
    const sourceStage = findStage('Source');
    expect(sourceStage).toBeDefined();

    const sourceActions = sourceStage.Actions.filter(
      (a: any) =>
        a.ActionTypeId?.Category === 'Source' &&
        a.ActionTypeId?.Provider === 'CodeStarSourceConnection',
    );
    expect(sourceActions.length).toBe(3);
  });

  test('has a CDK_Source action', () => {
    const sourceStage = findStage('Source');
    const cdkAction = sourceStage.Actions.find(
      (a: any) => a.Name === 'CDK_Source',
    );
    expect(cdkAction).toBeDefined();
    expect(cdkAction.ActionTypeId.Provider).toBe('CodeStarSourceConnection');
  });

  test('has a Lambda_Source action', () => {
    const sourceStage = findStage('Source');
    const lambdaAction = sourceStage.Actions.find(
      (a: any) => a.Name === 'Lambda_Source',
    );
    expect(lambdaAction).toBeDefined();
    expect(lambdaAction.ActionTypeId.Provider).toBe('CodeStarSourceConnection');
  });

  test('has a Frontend_Source action', () => {
    const sourceStage = findStage('Source');
    const frontendAction = sourceStage.Actions.find(
      (a: any) => a.Name === 'Frontend_Source',
    );
    expect(frontendAction).toBeDefined();
    expect(frontendAction.ActionTypeId.Provider).toBe('CodeStarSourceConnection');
  });
});

// ---------------------------------------------------------------------------
// Synth Step tests (Requirements 1.1, 1.4)
// ---------------------------------------------------------------------------

describe('Synth Step', () => {
  test('Build stage contains a Synth action', () => {
    const buildStage = findStage('Build');
    expect(buildStage).toBeDefined();

    const synthAction = buildStage.Actions.find(
      (a: any) => a.Name === 'Synth',
    );
    expect(synthAction).toBeDefined();
    expect(synthAction.ActionTypeId.Category).toBe('Build');
  });

  test('synth CodeBuild project runs npm ci and npx cdk synth', () => {
    const codeBuildProjects = template.findResources('AWS::CodeBuild::Project');
    const synthProject = Object.values(codeBuildProjects).find((proj: any) => {
      const buildSpec = proj.Properties?.Source?.BuildSpec;
      if (typeof buildSpec === 'string') {
        return buildSpec.includes('npm ci') && buildSpec.includes('npx cdk synth');
      }
      return false;
    });

    expect(synthProject).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Self-Mutation tests (Requirement 1.1, 1.3)
// ---------------------------------------------------------------------------

describe('Self-Mutation', () => {
  test('pipeline has an UpdatePipeline stage for self-mutation', () => {
    const updateStage = findStage('UpdatePipeline');
    expect(updateStage).toBeDefined();
    expect(updateStage.Actions.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Beta and Prod Stages tests (Requirements 6.1, 6.2, 6.3)
// ---------------------------------------------------------------------------

describe('Beta and Prod Stages', () => {
  test('pipeline has a Beta stage', () => {
    const betaStage = findStageContaining('beta');
    expect(betaStage).toBeDefined();
  });

  test('pipeline has a Prod stage', () => {
    const prodStage = findStageContaining('prod');
    expect(prodStage).toBeDefined();
  });

  test('Beta stage appears before Prod stage in the pipeline', () => {
    const betaIndex = pipelineStages.findIndex((s: any) =>
      s.Name?.toLowerCase().includes('beta'),
    );
    const prodIndex = pipelineStages.findIndex((s: any) =>
      s.Name?.toLowerCase().includes('prod'),
    );

    expect(betaIndex).toBeGreaterThan(-1);
    expect(prodIndex).toBeGreaterThan(-1);
    expect(betaIndex).toBeLessThan(prodIndex);
  });
});

// ---------------------------------------------------------------------------
// Synth Step builds Lambda + Frontend (Requirements 3.1, 3.5, 3a.5)
//
// Lambda and Frontend builds now run inside the Synth step so that
// the built artifacts are available when `cdk synth` packages them
// as cloud-assembly assets. The synth CodeBuild project's BuildSpec
// contains the Gradle and npm build commands.
// ---------------------------------------------------------------------------

describe('Synth Step builds Lambda and Frontend', () => {
  test('synth BuildSpec includes Lambda Gradle build command', () => {
    const codeBuildProjects = template.findResources('AWS::CodeBuild::Project');
    const synthProject = Object.values(codeBuildProjects).find((proj: any) => {
      const buildSpec = proj.Properties?.Source?.BuildSpec;
      return typeof buildSpec === 'string' && buildSpec.includes('npx cdk synth');
    });

    expect(synthProject).toBeDefined();
    const buildSpec = (synthProject as any).Properties.Source.BuildSpec;
    expect(buildSpec).toContain('gradlew shadowJar');
  });

  test('synth BuildSpec includes Frontend npm build command', () => {
    const codeBuildProjects = template.findResources('AWS::CodeBuild::Project');
    const synthProject = Object.values(codeBuildProjects).find((proj: any) => {
      const buildSpec = proj.Properties?.Source?.BuildSpec;
      return typeof buildSpec === 'string' && buildSpec.includes('npx cdk synth');
    });

    expect(synthProject).toBeDefined();
    const buildSpec = (synthProject as any).Properties.Source.BuildSpec;
    expect(buildSpec).toContain('npm run build');
  });

  test('synth BuildSpec copies Lambda JAR to placeholder directory', () => {
    const codeBuildProjects = template.findResources('AWS::CodeBuild::Project');
    const synthProject = Object.values(codeBuildProjects).find((proj: any) => {
      const buildSpec = proj.Properties?.Source?.BuildSpec;
      return typeof buildSpec === 'string' && buildSpec.includes('npx cdk synth');
    });

    expect(synthProject).toBeDefined();
    const buildSpec = (synthProject as any).Properties.Source.BuildSpec;
    expect(buildSpec).toContain('lambda/placeholder');
  });
});

// ---------------------------------------------------------------------------
// Manual Approval Step tests (Requirements 6.3)
// ---------------------------------------------------------------------------

describe('Manual Approval Step', () => {
  test('Prod stage has a manual approval action', () => {
    const prodStage = findStageContaining('prod');
    expect(prodStage).toBeDefined();

    const approvalAction = prodStage.Actions.find(
      (a: any) => a.ActionTypeId?.Category === 'Approval',
    );
    expect(approvalAction).toBeDefined();
  });

  test('manual approval action is named PromoteToProd', () => {
    const prodStage = findStageContaining('prod');
    const approvalAction = prodStage.Actions.find(
      (a: any) => a.ActionTypeId?.Category === 'Approval',
    );
    expect(approvalAction).toBeDefined();
    expect(approvalAction.Name).toContain('PromoteToProd');
  });
});

// ---------------------------------------------------------------------------
// Pipeline Notification Rule tests (Requirements 23.1, 23.2)
// ---------------------------------------------------------------------------

describe('Pipeline Notification Rule', () => {
  test('creates a CodeStar notification rule for pipeline failures', () => {
    template.hasResourceProperties('AWS::CodeStarNotifications::NotificationRule', {
      DetailType: 'FULL',
      EventTypeIds: Match.arrayWith([
        'codepipeline-pipeline-pipeline-execution-failed',
      ]),
    });
  });

  test('notification rule targets an SNS topic', () => {
    template.hasResourceProperties('AWS::CodeStarNotifications::NotificationRule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          TargetType: 'SNS',
        }),
      ]),
    });
  });
});

// ---------------------------------------------------------------------------
// BUILD_GENERAL1_SMALL Compute Type tests (Requirements 22.3, 22.6)
// ---------------------------------------------------------------------------

describe('CodeBuild Compute Type', () => {
  test('synth CodeBuild project uses BUILD_GENERAL1_SMALL compute type', () => {
    const codeBuildProjects = template.findResources('AWS::CodeBuild::Project');

    // The synth project is the one that runs `cdk synth`
    const synthProject = Object.entries(codeBuildProjects).find(([, proj]: [string, any]) => {
      const buildSpec = proj.Properties?.Source?.BuildSpec;
      return typeof buildSpec === 'string' && buildSpec.includes('npx cdk synth');
    });

    expect(synthProject).toBeDefined();
    expect(synthProject![1].Properties.Environment.ComputeType).toBe('BUILD_GENERAL1_SMALL');
  });
});
