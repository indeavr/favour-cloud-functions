import * as functions from 'firebase-functions';

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();

exports.decorateChatMesssages = functions.database.ref('/messages/{chatId}/{messageId}')
    .onWrite(async (change, context) => {
        if (context.authType === "ADMIN") {
            return
        }

        const {messageId} = context.params;

        const actualMessage = change.after.val();

        console.log('OPAAAAA', messageId, actualMessage.name);

        if (!context.auth!.uid) {
            console.error("no user id !");
        }
        actualMessage.timestamp = context.timestamp;
        actualMessage.senderId = context.auth!.uid;

        return change.after.ref.parent!.child(messageId).set(actualMessage)
    });

exports.sendMessageNotification = functions.database.ref('messages/{chatId}/{messageId}')
    .onWrite(async (change, context) => {
        // after decorateChatMesssages has completed
        console.log("sendMessageNotification called", context.authType);
        if (context.authType !== "ADMIN") {
            return
        }

        const {messageId, chatId} = context.params;
        // If un-follow we exit the function.
        const message = change.after.val();
        if (!message) {
            console.error('No Message', messageId);
            return;
        }

        const bothUsers = await admin.database().ref(`chats/${chatId}/users`).once("value");
        const users = bothUsers.val();

        console.log("users:", users, message);

        const sendedToId = Object.keys(users).find((id) => id !== message.senderId);

        console.log("Sended to id:", sendedToId, users);

        // Get the list of device notification tokens.
        const fcmTokenRefs = await admin.database()
            .ref(`/users/${sendedToId}/fcmTokens`).once('value');

        // Check if there are any device tokens.
        if (!fcmTokenRefs.hasChildren()) {
            console.log('There are no notification tokens to send to.');
            return;
        }
        console.log('There are', fcmTokenRefs.numChildren(), 'tokens to send notifications to.');

        const senderProfile = await admin.database().ref(`users/${message.senderId}`).once("value");

        // Notification details.
        const payload = {
            notification: {
                title: `You have a new message from ${senderProfile.fullName}`,
                body: message.text,
            },
            data: {
                sender: message.senderId
            }
        };

        // Listing all tokens as an array.
        const tokens = Object.keys(fcmTokenRefs.val());

        console.log("SENDING", tokens, payload)
        // Send notifications to all tokens.
        const response = await admin.messaging().sendToDevice(tokens, payload, {priority: "high"});
        console.log("response", response)

        // For each message check if there was an error.
        const tokensToRemove: any[] = [];
        response.results.forEach((result: any, index: any) => {
            const error = result.error;
            if (error) {
                console.error('Failure sending notification to', tokens[index], error);
                // Cleanup the tokens who are not registered anymore.
                if (error.code === 'messaging/invalid-registration-token' ||
                    error.code === 'messaging/registration-token-not-registered') {
                    tokensToRemove.push(fcmTokenRefs.ref.child(tokens[index]).remove());
                }
            }
        });
        return Promise.all(tokensToRemove);
    });
