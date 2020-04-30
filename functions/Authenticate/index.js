// Use this code snippet in your app.
// If you need more information about configurations or implementing the sample code, visit the AWS docs:
// https://aws.amazon.com/developers/getting-started/nodejs/

// Load the AWS SDK
const AWS = require('aws-sdk');
const url = require('url');
const https = require('https')

// Create a Secrets Manager client
var client = new AWS.SecretsManager({ region: "us-west-2" });

// In this sample we only handle the specific exceptions for the 'GetSecretValue' API.
// See https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
// We rethrow the exception by default.

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

exports.handler = async (event) => {
    let client_id = await getSecret(process.env.api_access_key_client_id_secret_id);
    let user_key = await getSecret(process.env.api_access_key_user_key_secret_id);
    
    let authUrl = process.env.api_access_auth_url;
    let apiAccessAuthOptions = url.parse(authUrl);
    let apiAccessAuthBody = JSON.stringify({ 
        grant_type: 'refresh_token',
        client_id, 
        refresh_token: user_key,
    });

    apiAccessAuthOptions.method = 'POST';
    apiAccessAuthOptions.headers = {
        'Content-Type': 'application/json',
        'Content-Length': apiAccessAuthBody.length
    };

    const access_token = await new Promise((resolve, reject) => {
        let apiAccessAuthReq = https.request(apiAccessAuthOptions, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (res) {
                let tokensObj = JSON.parse(res);
                if(!tokensObj.access_token) {
                    throw 'access_token not found';
                }
                
                resolve(tokensObj.access_token);
            });
        });
    
        apiAccessAuthReq.on('error', error => {
            throw error;
        });
    
        apiAccessAuthReq.write(apiAccessAuthBody)
        apiAccessAuthReq.end();
    });

    await updateSecret(process.env.access_token_secret_id, access_token);
};
