#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { PersonalWebsiteCdkStack } from '../lib/personal_website_cdk-stack';
import { CertificateAndHostedZoneStack } from '../lib/certificate-stack';

const app = new cdk.App();

const certificateStack = new CertificateAndHostedZoneStack(app, 'CertificateAndHostedZoneStack', {
    domainName: app.node.tryGetContext('domainName'),
    hostedZoneId: app.node.tryGetContext('hostedZoneId'),
});

new PersonalWebsiteCdkStack(app, 'PersonalWebsiteCdkStack', {
    domainName: app.node.tryGetContext('domainName'),
    certificate: certificateStack.certificate,
    hostedZone: certificateStack.hostedZone,
});

