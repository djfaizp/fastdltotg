const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
require('dotenv').config();

const apiId = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;

(async () => {
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('Please enter your phone number: '),
        password: async () => await input.text('Please enter your password: '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: (err) => console.log(err),
    });

    console.log('Your string session:', client.session.save());
    await client.disconnect();
})();