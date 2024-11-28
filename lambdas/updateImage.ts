import { SNSHandler } from "aws-lambda";
import {
    GetObjectCommand,
    PutObjectCommandInput,
    GetObjectCommandInput,
    S3Client,
    PutObjectCommand,
  } from "@aws-sdk/client-s3";
  import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
  import { DynamoDBDocumentClient, PutCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
  import { BadImage } from "/opt/types";
  import type { DynamoDBStreamHandler } from "aws-lambda";
  import Ajv from "ajv";
import schema from "../shared/types.schema.json";

const ajv = new Ajv();
const isValidBodyParams = ajv.compile(schema.definitions["metadata"] || {});

const ddbDocClient = createDDbDocClient();
const s3 = new S3Client();

export const handler: SNSHandler = async (event) => {
    console.log("Event ", JSON.stringify(event));
    try {
    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message)
        console.log("Message ", message)
        const id = message.id
        const value = message.value

        if (!id.includes(".png") && !id.includes(".jpeg")) {
            throw new Error(" Bad Image");
        }

        const srcKey = decodeURIComponent(id.replace(/\+/g, " "));

          const commandOutput = await ddbDocClient.send(
            new UpdateCommand({
              TableName: process.env.TABLE_NAME,
              UpdateExpression: 'SET #v = :val1',
              Key: {id: srcKey},
              ExpressionAttributeValues: {
                ":val1": value,
              },
              ExpressionAttributeNames: {
                "#v": "value"
              },
            })
          );

          console.log("Image updated in table.")
    }

} catch (error) {
    console.log(error);
}
}



function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({ region: process.env.REGION });
    const marshallOptions = {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    };
    const unmarshallOptions = {
      wrapNumbers: false,
    };
    return DynamoDBDocumentClient.from(ddbClient);
  }