#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { PersonalWebsiteCdkStack } from '../lib/personal_website_cdk-stack';
import { CertificateAndHostedZoneStack } from '../lib/certificate-stack';
import { ContactFormStack } from '../lib/contact-form-stack';

const app = new cdk.App();

const certificateStack = new CertificateAndHostedZoneStack(app, 'CertificateAndHostedZoneStack', {
    domainName: app.node.tryGetContext('domainName'),
    hostedZoneId: app.node.tryGetContext('hostedZoneId'),
});

const personalWebsiteStack = new PersonalWebsiteCdkStack(app, 'PersonalWebsiteCdkStack', {
    domainName: app.node.tryGetContext('domainName'),
    certificate: certificateStack.certificate,
    hostedZone: certificateStack.hostedZone,
});
personalWebsiteStack.addDependency(certificateStack);

const contactFormStack = new ContactFormStack(app, 'ContactFormStack', {
    certificate: certificateStack.apiCertificate,
    domainName: app.node.tryGetContext('domainName'),
    recipientEmail: app.node.tryGetContext('recipientEmail'),
    hostedZone: certificateStack.hostedZone
});
contactFormStack.addDependency(certificateStack);

