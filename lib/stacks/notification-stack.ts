import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface NotificationStackProps extends cdk.StackProps {
  /** Optional list of HTTPS endpoint URLs for webhook subscriptions (PagerDuty, OpsGenie, Slack, Discord) */
  readonly httpsEndpoints?: string[];
}

/**
 * Creates an SNS topic for alarm and pipeline failure notifications.
 * Supports HTTPS endpoint subscriptions for integration with PagerDuty,
 * OpsGenie, Slack, or Discord webhooks.
 */
export class NotificationStack extends cdk.Stack {
  /** The SNS topic for alarm and pipeline notifications */
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    // SNS topic for alarm and pipeline notifications
    // Use an explicit topic name to support cross-environment references
    // (e.g., when the pipeline notification rule references this topic
    // from a stack that deploys to cross-account stages)
    const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      displayName: 'Alarm and Pipeline Notifications',
      topicName: `${id}-NotificationTopic`,
    });

    // Create HTTPS subscriptions for each provided endpoint (PagerDuty, OpsGenie, Slack, Discord, etc.)
    if (props.httpsEndpoints) {
      props.httpsEndpoints.forEach((endpoint, index) => {
        notificationTopic.addSubscription(
          new sns_subscriptions.UrlSubscription(endpoint, {
            protocol: sns.SubscriptionProtocol.HTTPS,
          }),
        );
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: notificationTopic.topicArn,
      description: 'SNS topic ARN for alarm and pipeline notifications',
      exportName: `${this.stackName}-NotificationTopicArn`,
    });

    this.notificationTopic = notificationTopic;
  }
}
