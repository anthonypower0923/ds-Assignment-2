## CA2 - Distributed Systems.

__Name:__ ....Anthony Power .....

__SudentNo:__ .....20098384 ....

__Demo:__ ... https://youtu.be/bhbZIUJWZUI ......

### Phase 1

+ rejectionMailer lambda that triggers from an image being added to the DLQ and sends an email informing
the sender that the image is of the incorrect extension

### Phase 2

+ updateImage lambda that is triggered from publishing to the topic `aws sns publish --topic-arn "topic-arn" --message-attributes file://attributes.json --message file://message.json` and accepts an attribute file containing the metadata_type and the message body in the message.json file. This lambda takes the attribute value and updates that value with the one provided in the message body for the item of that id.

+ stringFilter policy on subscription to imageTopic for the above lambda to restrict it to ['Caption','Date','Photographer'] for metadata types.

### Phase 3

+ Delete functionality to processImage lambda based on event name from the messageRecord. Deleting item in the bucket deletes the relevant item in the database if it exists.

+ DynamoEventSource to trigger mailerFn when item is added to DynamoDB. Added check to mailerFn to prevent email being sent
when object deleted from bucket.

