import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NotificationStack, NotificationStackProps } from '../../lib/stacks/notification-stack';

/**
 * CDK assertion tests for NotificationStack.
 *
 * Validates: SNS topic creation, HTTPS endpoint subscription support,
 * and CfnOutput for the topic ARN.
 *
 * Requirements: 17.1, 17.3
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestStack(overrides?: Partial<NotificationStackProps>): {
  stack: NotificationStack;
  template: Template;
} {
  const app = new cdk.App();

  const stack = new NotificationStack(app, 'TestNotificationStack', {
    env: { account: '222222222222', region: 'us-east-2' },
    ...overrides,
  });

  const template = Template.fromStack(stack);
  return { stack, template };
}

// ---------------------------------------------------------------------------
// SNS Topic tests (Requirement 17.1)
// ---------------------------------------------------------------------------

describe('SNS Topic', () => {
  test('creates an SNS topic for notifications', () => {
    const { template } = createTestStack();

    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('SNS topic has a display name', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: Match.anyValue(),
    });
  });
});

// ---------------------------------------------------------------------------
// HTTPS Subscription tests (Requirement 17.3)
// ---------------------------------------------------------------------------

describe('HTTPS Subscriptions', () => {
  test('creates HTTPS subscriptions for provided endpoints', () => {
    const { template } = createTestStack({
      httpsEndpoints: [
        'https://events.pagerduty.com/integration/abc123/enqueue',
        'https://hooks.slack.com/services/T00/B00/xxxx',
      ],
    });

    template.resourceCountIs('AWS::SNS::Subscription', 2);

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'https',
      Endpoint: 'https://events.pagerduty.com/integration/abc123/enqueue',
    });

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'https',
      Endpoint: 'https://hooks.slack.com/services/T00/B00/xxxx',
    });
  });

  test('creates no subscriptions when no endpoints are provided', () => {
    const { template } = createTestStack();

    const subscriptions = template.findResources('AWS::SNS::Subscription');
    expect(Object.keys(subscriptions).length).toBe(0);
  });

  test('creates a single subscription for one endpoint', () => {
    const { template } = createTestStack({
      httpsEndpoints: ['https://api.opsgenie.com/v1/json/cloudwatch?apiKey=xyz'],
    });

    template.resourceCountIs('AWS::SNS::Subscription', 1);

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'https',
      Endpoint: 'https://api.opsgenie.com/v1/json/cloudwatch?apiKey=xyz',
    });
  });
});

// ---------------------------------------------------------------------------
// Stack Outputs tests
// ---------------------------------------------------------------------------

describe('Stack Outputs', () => {
  test('outputs the notification topic ARN', () => {
    const { template } = createTestStack();

    template.hasOutput('NotificationTopicArn', {
      Value: Match.anyValue(),
    });
  });
});
