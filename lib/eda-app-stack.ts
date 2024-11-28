import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

import { Construct } from "constructs";
import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import {  DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

  // Image Table

  const imagesTable = new dynamodb.Table(this, "ImagesTable", {
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    partitionKey: { name: "id", type: dynamodb.AttributeType.STRING},
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    tableName: "Images",
    stream: StreamViewType.NEW_IMAGE,
  });

  // Integration infrastructure

  const badImagesQueue = new sqs.Queue(this, "bad-image-q", {
    retentionPeriod: cdk.Duration.minutes(10),
  });

  const imagesQueue = new sqs.Queue(this, "images-queue", {
    deadLetterQueue: {
      queue: badImagesQueue,
      // # of rejections by consumer (lambda function)
      maxReceiveCount: 1,
    },
  });

  const mailerQ = new sqs.Queue(this, "mailer-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  const rejectedMailQ = new sqs.Queue(this, "rejected-mail-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  // Image Topic

  const imageTopic = new sns.Topic(this, "ImageTopic", {
    displayName: "Image topic",
  }); 

  // Lambda functions

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imagesTable.tableName,
        REGION: 'eu-west-1',
      }
    }
  );

  const updateImageFn = new lambdanode.NodejsFunction(
    this,
    "UpdateImageFn",
    {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 128,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/updateImage.ts`,
      environment: {
        TABLE_NAME: imagesTable.tableName,
        REGION: 'eu-west-1',
      }
    }
  );

  const failedMailerFn = new lambdanode.NodejsFunction(this, "FailedMailerFn", {
    runtime: lambda.Runtime.NODEJS_16_X,
    entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    timeout: cdk.Duration.seconds(3),
    memorySize: 1024,
  });

  const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
  });


  // S3 --> SQS
  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SnsDestination(imageTopic)  // Changed
);

  // SQS --> Lambda
  imageTopic.addSubscription(
  new subs.SqsSubscription(imagesQueue)
  );

  imageTopic.addSubscription(
    new subs.LambdaSubscription(updateImageFn, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ['Caption','Date','Photographer']
        }),
    }}
    )
  )

  imageTopic.addSubscription(new subs.SqsSubscription(mailerQ));
  imageTopic.addSubscription(new subs.SqsSubscription(rejectedMailQ))

  const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  // const rejectedMailEventSource = new events.SqsEventSource(rejectedMailQ, {
  //   batchSize: 5,
  //   maxBatchingWindow: cdk.Duration.seconds(5),
  // });

  processImageFn.addEventSource(
    new SqsEventSource(imagesQueue, {
      maxBatchingWindow: cdk.Duration.seconds(5),
      maxConcurrency: 2,  
    })
  );

  // processImageFn.addEventSource(
  //   new DynamoEventSource(imagesTable, {
  //      startingPosition: StartingPosition.LATEST 
  //   })
  // )

  processImageFn.addEventSource(
    new SqsEventSource(badImagesQueue, {
      maxBatchingWindow: cdk.Duration.seconds(10),
      maxConcurrency: 2,
    }));


  mailerFn.addEventSource(newImageMailEventSource);
  // failedMailerFn.addEventSource(rejectedMailEventSource)

  failedMailerFn.addEventSource(
    new SqsEventSource(badImagesQueue, {
      maxBatchingWindow: cdk.Duration.seconds(10),
      maxConcurrency: 2,
    })
  );

  // Permissions

  imagesBucket.grantRead(processImageFn);

  imagesTable.grantReadWriteData(processImageFn);
  imagesTable.grantReadWriteData(updateImageFn)

  mailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  failedMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );


    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "topicARN", {
      value: imageTopic.topicArn,
    });
  }
}
