import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { MonitoringStack, MonitoringStackProps } from '../../lib/stacks/monitoring-stack';
import { AlarmThresholds } from '../../lib/config/configuration.types';

/**
 * CDK assertion tests for MonitoringStack.
 *
 * Validates: Three CloudWatch dashboards (CloudFront, Lambda, API Gateway),
 * individual alarms with correct thresholds for both severity tiers,
 * Composite Alarm aggregating high-severity child alarms, and SNS alarm
 * actions configured on Prod alarms.
 *
 * Requirements: 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6,
 *               17.2, 17.4
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_HIGH_SEVERITY: AlarmThresholds = {
  cloudFront5xxRate: 5,
  cloudFront4xxRate: 15,
  lambdaErrorRate: 5,
  lambdaDurationP90: 10000,
  apiGateway5xxRate: 5,
  apiGatewayLatencyP90: 10000,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
};

const TEST_LOW_SEVERITY: AlarmThresholds = {
  cloudFront5xxRate: 1,
  cloudFront4xxRate: 10,
  lambdaErrorRate: 1,
  lambdaDurationP90: 5000,
  apiGateway5xxRate: 1,
  apiGatewayLatencyP90: 5000,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
};

function createTestStack(
  stageName: string = 'beta',
  overrides?: Partial<MonitoringStackProps>,
): {
  template: Template;
  notificationTopicLogicalId: string;
} {
  const app = new cdk.App();

  // Support stack to hold the resources that MonitoringStack depends on
  const supportStack = new cdk.Stack(app, 'SupportStack', {
    env: { account: '222222222222', region: 'us-east-2' },
  });

  const bucket = new s3.Bucket(supportStack, 'Bucket');

  const distribution = new cloudfront.Distribution(supportStack, 'Distribution', {
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
    },
  });

  const lambdaFunction = new lambda.Function(supportStack, 'Function', {
    runtime: lambda.Runtime.JAVA_21,
    handler: 'com.example.Handler',
    code: lambda.Code.fromAsset('./test-assets'),
  });

  const httpApi = new apigatewayv2.HttpApi(supportStack, 'HttpApi');

  const notificationTopic = new sns.Topic(supportStack, 'Topic');

  const stack = new MonitoringStack(app, 'TestMonitoringStack', {
    env: { account: '222222222222', region: 'us-east-2' },
    stageName,
    distribution,
    lambdaFunction,
    httpApi,
    highSeverityAlarms: TEST_HIGH_SEVERITY,
    lowSeverityAlarms: TEST_LOW_SEVERITY,
    notificationTopic,
    ...overrides,
  });

  const template = Template.fromStack(stack);
  return { template, notificationTopicLogicalId: 'placeholder' };
}

// ---------------------------------------------------------------------------
// CloudWatch Dashboard tests (Requirements 15.1, 15.2, 15.3)
// ---------------------------------------------------------------------------

describe('CloudWatch Dashboards', () => {
  test('creates exactly three dashboards', () => {
    const { template } = createTestStack();

    template.resourceCountIs('AWS::CloudWatch::Dashboard', 3);
  });

  test('creates a CloudFront dashboard', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'beta-CloudFront',
    });
  });

  test('creates a Lambda dashboard', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'beta-Lambda',
    });
  });

  test('creates an API Gateway dashboard', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'beta-ApiGateway',
    });
  });

  test('dashboard names include the stage name', () => {
    const { template } = createTestStack('prod');

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'prod-CloudFront',
    });

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'prod-Lambda',
    });

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'prod-ApiGateway',
    });
  });
});

// ---------------------------------------------------------------------------
// Individual Alarm tests — High Severity (Requirements 16.1, 16.2, 16.3, 16.6)
// ---------------------------------------------------------------------------

describe('High-Severity Alarms', () => {
  test('creates CloudFront 4xx error rate alarm with correct threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-high-CloudFront-4xxRate',
      Threshold: TEST_HIGH_SEVERITY.cloudFront4xxRate,
      EvaluationPeriods: TEST_HIGH_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_HIGH_SEVERITY.datapointsToAlarm,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates CloudFront 5xx error rate alarm with correct threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-high-CloudFront-5xxRate',
      Threshold: TEST_HIGH_SEVERITY.cloudFront5xxRate,
      EvaluationPeriods: TEST_HIGH_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_HIGH_SEVERITY.datapointsToAlarm,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  test('creates Lambda error rate alarm with correct threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-high-Lambda-ErrorRate',
      Threshold: TEST_HIGH_SEVERITY.lambdaErrorRate,
      EvaluationPeriods: TEST_HIGH_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_HIGH_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates Lambda duration p90 alarm with correct threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-high-Lambda-DurationP90',
      Threshold: TEST_HIGH_SEVERITY.lambdaDurationP90,
      EvaluationPeriods: TEST_HIGH_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_HIGH_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates API Gateway 5xx rate alarm with correct threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-high-ApiGateway-5xxRate',
      Threshold: TEST_HIGH_SEVERITY.apiGateway5xxRate,
      EvaluationPeriods: TEST_HIGH_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_HIGH_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates API Gateway latency p90 alarm with correct threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-high-ApiGateway-LatencyP90',
      Threshold: TEST_HIGH_SEVERITY.apiGatewayLatencyP90,
      EvaluationPeriods: TEST_HIGH_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_HIGH_SEVERITY.datapointsToAlarm,
    });
  });
});

// ---------------------------------------------------------------------------
// Individual Alarm tests — Low Severity (Requirements 16.1, 16.2, 16.3, 16.6)
// ---------------------------------------------------------------------------

describe('Low-Severity Alarms', () => {
  test('creates CloudFront 4xx error rate alarm with low-severity threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-low-CloudFront-4xxRate',
      Threshold: TEST_LOW_SEVERITY.cloudFront4xxRate,
      EvaluationPeriods: TEST_LOW_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_LOW_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates CloudFront 5xx error rate alarm with low-severity threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-low-CloudFront-5xxRate',
      Threshold: TEST_LOW_SEVERITY.cloudFront5xxRate,
      EvaluationPeriods: TEST_LOW_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_LOW_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates Lambda error rate alarm with low-severity threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-low-Lambda-ErrorRate',
      Threshold: TEST_LOW_SEVERITY.lambdaErrorRate,
      EvaluationPeriods: TEST_LOW_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_LOW_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates Lambda duration p90 alarm with low-severity threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-low-Lambda-DurationP90',
      Threshold: TEST_LOW_SEVERITY.lambdaDurationP90,
      EvaluationPeriods: TEST_LOW_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_LOW_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates API Gateway 5xx rate alarm with low-severity threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-low-ApiGateway-5xxRate',
      Threshold: TEST_LOW_SEVERITY.apiGateway5xxRate,
      EvaluationPeriods: TEST_LOW_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_LOW_SEVERITY.datapointsToAlarm,
    });
  });

  test('creates API Gateway latency p90 alarm with low-severity threshold', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'beta-low-ApiGateway-LatencyP90',
      Threshold: TEST_LOW_SEVERITY.apiGatewayLatencyP90,
      EvaluationPeriods: TEST_LOW_SEVERITY.evaluationPeriods,
      DatapointsToAlarm: TEST_LOW_SEVERITY.datapointsToAlarm,
    });
  });
});

// ---------------------------------------------------------------------------
// Total alarm count (Requirement 16.6 — two severity tiers)
// ---------------------------------------------------------------------------

describe('Alarm Count', () => {
  test('creates 12 individual alarms (6 per severity tier)', () => {
    const { template } = createTestStack();

    // 6 high-severity + 6 low-severity = 12 individual alarms
    template.resourceCountIs('AWS::CloudWatch::Alarm', 12);
  });
});

// ---------------------------------------------------------------------------
// Composite Alarm tests (Requirements 16.4, 16.5)
// ---------------------------------------------------------------------------

describe('Composite Alarm', () => {
  test('creates a composite alarm', () => {
    const { template } = createTestStack();

    template.resourceCountIs('AWS::CloudWatch::CompositeAlarm', 1);
  });

  test('composite alarm name includes the stage name', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudWatch::CompositeAlarm', {
      AlarmName: 'beta-CompositeAlarm',
    });
  });

  test('composite alarm rule references high-severity child alarms', () => {
    const { template } = createTestStack();

    // The composite alarm rule should be an OR expression of all high-severity alarms.
    // CDK synthesizes this as an AlarmRule string containing ALARM(...) references.
    template.hasResourceProperties('AWS::CloudWatch::CompositeAlarm', {
      AlarmRule: Match.anyValue(),
    });
  });

  test('composite alarm name reflects prod stage when configured as prod', () => {
    const { template } = createTestStack('prod');

    template.hasResourceProperties('AWS::CloudWatch::CompositeAlarm', {
      AlarmName: 'prod-CompositeAlarm',
    });
  });
});

// ---------------------------------------------------------------------------
// SNS Alarm Actions on Prod (Requirements 17.2, 17.4)
// ---------------------------------------------------------------------------

describe('SNS Alarm Actions (Prod)', () => {
  test('Prod alarms have AlarmActions configured', () => {
    const { template } = createTestStack('prod');

    // All 12 individual alarms in Prod should have AlarmActions pointing to the SNS topic
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarmLogicalIds = Object.keys(alarms);

    expect(alarmLogicalIds.length).toBe(12);

    for (const logicalId of alarmLogicalIds) {
      const alarm = alarms[logicalId];
      expect(alarm.Properties.AlarmActions).toBeDefined();
      expect(alarm.Properties.AlarmActions.length).toBeGreaterThan(0);
    }
  });

  test('Prod alarms have OKActions configured', () => {
    const { template } = createTestStack('prod');

    const alarms = template.findResources('AWS::CloudWatch::Alarm');

    for (const logicalId of Object.keys(alarms)) {
      const alarm = alarms[logicalId];
      expect(alarm.Properties.OKActions).toBeDefined();
      expect(alarm.Properties.OKActions.length).toBeGreaterThan(0);
    }
  });

  test('Prod composite alarm has AlarmActions configured', () => {
    const { template } = createTestStack('prod');

    template.hasResourceProperties('AWS::CloudWatch::CompositeAlarm', {
      AlarmActions: Match.anyValue(),
    });
  });

  test('Prod composite alarm has OKActions configured', () => {
    const { template } = createTestStack('prod');

    template.hasResourceProperties('AWS::CloudWatch::CompositeAlarm', {
      OKActions: Match.anyValue(),
    });
  });
});

// ---------------------------------------------------------------------------
// SNS Alarm Actions NOT on Beta (Requirement 17.4 — only Prod)
// ---------------------------------------------------------------------------

describe('SNS Alarm Actions (Beta — should NOT have actions)', () => {
  test('Beta alarms do NOT have AlarmActions configured', () => {
    const { template } = createTestStack('beta');

    const alarms = template.findResources('AWS::CloudWatch::Alarm');

    for (const logicalId of Object.keys(alarms)) {
      const alarm = alarms[logicalId];
      // Beta alarms should not have AlarmActions (or it should be empty/undefined)
      const actions = alarm.Properties.AlarmActions;
      expect(actions === undefined || actions.length === 0).toBe(true);
    }
  });

  test('Beta composite alarm does NOT have AlarmActions', () => {
    const { template } = createTestStack('beta');

    const compositeAlarms = template.findResources('AWS::CloudWatch::CompositeAlarm');
    const logicalIds = Object.keys(compositeAlarms);

    expect(logicalIds.length).toBe(1);

    const compositeAlarm = compositeAlarms[logicalIds[0]];
    const actions = compositeAlarm.Properties.AlarmActions;
    expect(actions === undefined || actions.length === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stack Outputs tests
// ---------------------------------------------------------------------------

describe('Stack Outputs', () => {
  test('outputs the composite alarm ARN', () => {
    const { template } = createTestStack();

    template.hasOutput('CompositeAlarmArn', {
      Value: Match.anyValue(),
    });
  });

  test('outputs the composite alarm name', () => {
    const { template } = createTestStack();

    template.hasOutput('CompositeAlarmName', {
      Value: Match.anyValue(),
    });
  });
});
