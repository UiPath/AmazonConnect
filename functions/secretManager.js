const AWS = require('aws-sdk');
const client = new AWS.SecretsManager();

async function getSecret(secretId, callback) {
    return new Promise((resolve, reject) => {
        client.getSecretValue({ SecretId: secretId }, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.SecretString);
            }
        });
    });
}

async function updateSecret(secretId, secretValue) {
    return new Promise((resolve, reject) => {
        client.updateSecret({ SecretId: secretId, SecretString: secretValue }, function (error, data) {
            if (error) {
                reject(error);
            } else {
                resolve(null);
            }
        });
    });
}

module.exports = {
    getSecret,
    updateSecret
};
