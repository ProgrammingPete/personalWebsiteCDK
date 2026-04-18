import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct } from 'constructs';
import { AlarmThresholds } from '../config/configuration.types';

export interface MonitoringStackProps extends cdk.StackProps {
  /** Stage name (e.g., 'beta' or 'prod') — determines whether SNS alarm actions are configured */
  readonly stageName: string;
  /** The CloudFront distribution to monitor */
  readonly distribution: cloudfront.Distribution;
  /** The Lambda function to monitor */
  readonly lambdaFunction: lambda.Function;
  /** The API Gateway HTTP API to monitor */
  readonly httpApi: apigatewayv2.HttpApi;
  /** High-severity alarm thresholds from Configuration Registry */
  readonly highSeverityAlarms: AlarmThresholds;
  /** Low-severity alarm thresholds from Configuration Registry */
  readonly lowSeverityAlarms: AlarmThresholds;
  /** SNS topic for alarm notifications */
  readonly notificationTopic: sns.Topic;
}

/**
 * Creates CloudWatch dashboards for CloudFront, Lambda, and API Gateway metrics,
 * individual alarms with configurable thresholds for two severity tiers,
 * a composite alarm aggregating all high-severity child alarms into a single
 * rollback signal, and SNS alarm actions on all Prod alarms.
 */
export class MonitoringStack extends cdk.Stack {
  /** Composite alarm aggregating all high-severity child alarms (used for pipeline rollback monitoring) */
  public readonly compositeAlarm: cloudwatch.CompositeAlarm;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const isProd = props.stageName === 'prod';
    const snsAction = new cloudwatch_actions.SnsAction(props.notificationTopic);

    // ---- CloudFront Metrics ----
    // Dashboard metrics use region: 'us-east-1' so the dashboard JSON renders
    // cross-region widgets correctly. Alarm metrics omit the region property
    // because CDK does not allow creating an alarm in one region based on a
    // metric in another region — CloudFront publishes global metrics that are
    // accessible from us-east-1 and the alarm will be created there at deploy
    // time via the dashboard/alarm stack placement.
    const distributionId = props.distribution.distributionId;

    const cfDimensions = { DistributionId: distributionId, Region: 'Global' };

    // Metrics for dashboards (with explicit region for cross-region rendering)
    const cfRequestCount = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: 'Requests',
      dimensionsMap: cfDimensions,
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
      region: 'us-east-1',
    });

    const cf4xxErrorRateDashboard = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: '4xxErrorRate',
      dimensionsMap: cfDimensions,
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      region: 'us-east-1',
    });

    const cf5xxErrorRateDashboard = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: '5xxErrorRate',
      dimensionsMap: cfDimensions,
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      region: 'us-east-1',
    });

    const cfTotalErrorRate = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: 'TotalErrorRate',
      dimensionsMap: cfDimensions,
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      region: 'us-east-1',
    });

    const cfBytesDownloaded = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: 'BytesDownloaded',
      dimensionsMap: cfDimensions,
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
      region: 'us-east-1',
    });

    const cfCacheHitRate = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: 'CacheHitRate',
      dimensionsMap: cfDimensions,
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      region: 'us-east-1',
    });

    // Metrics for alarms (no region — avoids CDK cross-region alarm validation)
    const cf4xxErrorRate = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: '4xxErrorRate',
      dimensionsMap: cfDimensions,
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const cf5xxErrorRate = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: '5xxErrorRate',
      dimensionsMap: cfDimensions,
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // ---- Lambda Metrics ----
    const functionName = props.lambdaFunction.functionName;

    const lambdaInvocations = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Invocations',
      dimensionsMap: { FunctionName: functionName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaErrors = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: { FunctionName: functionName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaDurationP50 = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      dimensionsMap: { FunctionName: functionName },
      statistic: 'p50',
      period: cdk.Duration.minutes(5),
    });

    const lambdaDurationP90 = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      dimensionsMap: { FunctionName: functionName },
      statistic: 'p90',
      period: cdk.Duration.minutes(5),
    });

    const lambdaThrottles = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Throttles',
      dimensionsMap: { FunctionName: functionName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaConcurrentExecutions = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'ConcurrentExecutions',
      dimensionsMap: { FunctionName: functionName },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    // ---- API Gateway Metrics ----
    const apiId = props.httpApi.apiId;

    const apiRequestCount = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api4xxCount = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4xx',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api5xxCount = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const apiLatencyP50 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: { ApiId: apiId },
      statistic: 'p50',
      period: cdk.Duration.minutes(5),
    });

    const apiLatencyP90 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: { ApiId: apiId },
      statistic: 'p90',
      period: cdk.Duration.minutes(5),
    });

    const apiIntegrationLatency = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'IntegrationLatency',
      dimensionsMap: { ApiId: apiId },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // ---- CloudWatch Dashboards ----

    // CloudFront Dashboard (Req 15.1)
    new cloudwatch.Dashboard(this, 'CloudFrontDashboard', {
      dashboardName: `${props.stageName}-CloudFront`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Request Count',
            left: [cfRequestCount],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: '4xx Error Rate',
            left: [cf4xxErrorRateDashboard],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: '5xx Error Rate',
            left: [cf5xxErrorRateDashboard],
            width: 8,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Total Error Rate',
            left: [cfTotalErrorRate],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Bytes Downloaded',
            left: [cfBytesDownloaded],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Cache Hit Rate',
            left: [cfCacheHitRate],
            width: 8,
          }),
        ],
      ],
    });

    // Lambda Dashboard (Req 15.2)
    new cloudwatch.Dashboard(this, 'LambdaDashboard', {
      dashboardName: `${props.stageName}-Lambda`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Invocation Count',
            left: [lambdaInvocations],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Error Count',
            left: [lambdaErrors],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Duration (p50 / p90)',
            left: [lambdaDurationP50, lambdaDurationP90],
            width: 8,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Throttle Count',
            left: [lambdaThrottles],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Concurrent Executions',
            left: [lambdaConcurrentExecutions],
            width: 8,
          }),
        ],
      ],
    });

    // API Gateway Dashboard (Req 15.3)
    new cloudwatch.Dashboard(this, 'ApiGatewayDashboard', {
      dashboardName: `${props.stageName}-ApiGateway`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Request Count',
            left: [apiRequestCount],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: '4xx Count',
            left: [api4xxCount],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: '5xx Count',
            left: [api5xxCount],
            width: 8,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Latency (p50 / p90)',
            left: [apiLatencyP50, apiLatencyP90],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Integration Latency',
            left: [apiIntegrationLatency],
            width: 8,
          }),
        ],
      ],
    });

    // ---- Alarms ----
    const allHighSeverityAlarms: cloudwatch.Alarm[] = [];

    // Helper to create alarms for a severity tier
    const createAlarms = (
      tier: 'high' | 'low',
      thresholds: AlarmThresholds,
    ): cloudwatch.Alarm[] => {
      const prefix = `${props.stageName}-${tier}`;
      const alarms: cloudwatch.Alarm[] = [];

      // CloudFront 4xx error rate alarm (Req 16.1)
      const cf4xxAlarm = new cloudwatch.Alarm(this, `${tier}-CF4xxAlarm`, {
        alarmName: `${prefix}-CloudFront-4xxRate`,
        alarmDescription: `CloudFront 4xx error rate exceeds ${thresholds.cloudFront4xxRate}% (${tier}-severity) in ${props.stageName}`,
        metric: cf4xxErrorRate,
        threshold: thresholds.cloudFront4xxRate,
        evaluationPeriods: thresholds.evaluationPeriods,
        datapointsToAlarm: thresholds.datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarms.push(cf4xxAlarm);

      // CloudFront 5xx error rate alarm (Req 16.1)
      const cf5xxAlarm = new cloudwatch.Alarm(this, `${tier}-CF5xxAlarm`, {
        alarmName: `${prefix}-CloudFront-5xxRate`,
        alarmDescription: `CloudFront 5xx error rate exceeds ${thresholds.cloudFront5xxRate}% (${tier}-severity) in ${props.stageName}`,
        metric: cf5xxErrorRate,
        threshold: thresholds.cloudFront5xxRate,
        evaluationPeriods: thresholds.evaluationPeriods,
        datapointsToAlarm: thresholds.datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarms.push(cf5xxAlarm);

      // Lambda error rate alarm using MathExpression (Req 16.2)
      const lambdaErrorRateExpr = new cloudwatch.MathExpression({
        expression: 'IF(invocations > 0, errors / invocations * 100, 0)',
        usingMetrics: {
          errors: lambdaErrors,
          invocations: lambdaInvocations,
        },
        period: cdk.Duration.minutes(5),
        label: 'Lambda Error Rate (%)',
      });

      const lambdaErrorRateAlarm = new cloudwatch.Alarm(this, `${tier}-LambdaErrorRateAlarm`, {
        alarmName: `${prefix}-Lambda-ErrorRate`,
        alarmDescription: `Lambda error rate exceeds ${thresholds.lambdaErrorRate}% (${tier}-severity) in ${props.stageName}`,
        metric: lambdaErrorRateExpr,
        threshold: thresholds.lambdaErrorRate,
        evaluationPeriods: thresholds.evaluationPeriods,
        datapointsToAlarm: thresholds.datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarms.push(lambdaErrorRateAlarm);

      // Lambda duration p90 alarm (Req 16.2)
      const lambdaDurationAlarm = new cloudwatch.Alarm(this, `${tier}-LambdaDurationP90Alarm`, {
        alarmName: `${prefix}-Lambda-DurationP90`,
        alarmDescription: `Lambda duration p90 exceeds ${thresholds.lambdaDurationP90}ms (${tier}-severity) in ${props.stageName}`,
        metric: lambdaDurationP90,
        threshold: thresholds.lambdaDurationP90,
        evaluationPeriods: thresholds.evaluationPeriods,
        datapointsToAlarm: thresholds.datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarms.push(lambdaDurationAlarm);

      // API Gateway 5xx rate alarm using MathExpression (Req 16.3)
      const api5xxRateExpr = new cloudwatch.MathExpression({
        expression: 'IF(requestCount > 0, errors5xx / requestCount * 100, 0)',
        usingMetrics: {
          errors5xx: api5xxCount,
          requestCount: apiRequestCount,
        },
        period: cdk.Duration.minutes(5),
        label: 'API Gateway 5xx Rate (%)',
      });

      const api5xxRateAlarm = new cloudwatch.Alarm(this, `${tier}-Api5xxRateAlarm`, {
        alarmName: `${prefix}-ApiGateway-5xxRate`,
        alarmDescription: `API Gateway 5xx rate exceeds ${thresholds.apiGateway5xxRate}% (${tier}-severity) in ${props.stageName}`,
        metric: api5xxRateExpr,
        threshold: thresholds.apiGateway5xxRate,
        evaluationPeriods: thresholds.evaluationPeriods,
        datapointsToAlarm: thresholds.datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarms.push(api5xxRateAlarm);

      // API Gateway latency p90 alarm (Req 16.3)
      const apiLatencyAlarm = new cloudwatch.Alarm(this, `${tier}-ApiLatencyP90Alarm`, {
        alarmName: `${prefix}-ApiGateway-LatencyP90`,
        alarmDescription: `API Gateway latency p90 exceeds ${thresholds.apiGatewayLatencyP90}ms (${tier}-severity) in ${props.stageName}`,
        metric: apiLatencyP90,
        threshold: thresholds.apiGatewayLatencyP90,
        evaluationPeriods: thresholds.evaluationPeriods,
        datapointsToAlarm: thresholds.datapointsToAlarm,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarms.push(apiLatencyAlarm);

      // Configure SNS alarm actions on all Prod alarms (Req 17.2, 17.4)
      if (isProd) {
        for (const alarm of alarms) {
          alarm.addAlarmAction(snsAction);
          alarm.addOkAction(snsAction);
        }
      }

      return alarms;
    };

    // Create high-severity alarms (Req 16.6)
    const highAlarms = createAlarms('high', props.highSeverityAlarms);
    allHighSeverityAlarms.push(...highAlarms);

    // Create low-severity alarms (Req 16.6)
    createAlarms('low', props.lowSeverityAlarms);

    // ---- Composite Alarm (Req 16.4, 16.5) ----
    // Aggregates all high-severity child alarms into a single rollback signal
    const compositeAlarm = new cloudwatch.CompositeAlarm(this, 'CompositeAlarm', {
      compositeAlarmName: `${props.stageName}-CompositeAlarm`,
      alarmDescription: `Composite alarm for ${props.stageName} — enters ALARM when any high-severity child alarm fires`,
      alarmRule: cloudwatch.AlarmRule.anyOf(...allHighSeverityAlarms),
    });

    // Configure SNS action on composite alarm for Prod (Req 16.5)
    if (isProd) {
      compositeAlarm.addAlarmAction(snsAction);
      compositeAlarm.addOkAction(snsAction);
    }

    // Outputs
    new cdk.CfnOutput(this, 'CompositeAlarmArn', {
      value: compositeAlarm.alarmArn,
      description: `Composite alarm ARN for ${props.stageName} rollback monitoring`,
    });

    new cdk.CfnOutput(this, 'CompositeAlarmName', {
      value: compositeAlarm.alarmName,
      description: `Composite alarm name for ${props.stageName}`,
    });

    this.compositeAlarm = compositeAlarm;
  }
}
