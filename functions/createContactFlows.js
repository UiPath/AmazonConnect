'use strict';
const aws = require("aws-sdk");
const https = require("https");
const url = require("url");
const path = require('path');
const initAppInsights = require('./appInsights.js');
const { SOURCE } = require('./constants.js');

function createContactFlow(properties, contactFlow) {
    var contactFlowBody = JSON.stringify(require(contactFlow));

    if (!properties.bucketName)
        throw ("Bucket name not specified");

    var bucketName = properties.bucketName;

    contactFlowBody = contactFlowBody.replace('##CREATE_INPUT_PARAMS_LAMBDA_ARN##', properties.CreateInputParamsLambdaArn || '');
    contactFlowBody = contactFlowBody.replace('##START_JOB_LAMBDA_ARN##', properties.StartJobLambdaArn || '');
    contactFlowBody = contactFlowBody.replace('##QUERY_JOB_LAMBDA_ARN##', properties.QueryJobLambdaArn || '');

    var S3 = new aws.S3();
    S3.putObject({
        Bucket: bucketName,
        Key: contactFlow,
        Body: contactFlowBody
    }, function (err, data) {

        if (err)
            throw (err);

        return;
    });
}

createContactFlow.handler = async function (event, context) {
    const appInsightsClient = initAppInsights();

    if (event.RequestType == 'Delete') {
        return sendResponse(event, context, "SUCCESS");
    }

    let contactFlows = [
        'UiPath Inbound Example.json',
        'UiPath Outbound Example.json',
    ];


    try {
        contactFlows.forEach(contactFlow => {
            createContactFlow(event.ResourceProperties, contactFlow);
        });

        appInsightsClient.trackEvent({
            name: 'ContactFlowsCreated',
            properties: {
                source: SOURCE,
                accountName: process.env.accountName,
                tenantName: process.env.tenantName,
            }
        });
    
        await appInsightsClient.flush();

        return await sendResponse(event, context, 'SUCCESS');
    } catch (err) {
        return sendResponse(event, context, 'FAILED', err);
    }
};

function getReason(err) {
    if (err)
        return err.message;
    else
        return '';
}


function sendResponse(event, context, status, err) {
    // only send response when called via CFT
    if (!event.ResponseURL || !event.StackId || !event.RequestId || !event.LogicalResourceId) {
        return;
    }

    var responseBody = {
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        PhysicalResourceId: context.logStreamName,
        Status: status,
        Reason: getReason(err) + " See details in CloudWatch Log: " + context.logStreamName,
    };

    var json = JSON.stringify(responseBody);
    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": json.length
        }
    };

    return new Promise(function(resolve, reject) {
        var request = https.request(options, function (response) {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                return reject(new Error('statusCode=' + response.statusCode));
            }
            
            console.log("STATUS: " + response.statusCode);
            console.log("HEADERS: " + JSON.stringify(response.headers));
            
            response.on("end", function () {
                resolve({});
            });
        });

        request.on("error", function (error) {
            console.log("sendResponse Error:\n", error);
            reject(error);
        });
    
        request.write(json);
        request.end();
    })
}

module.exports = createContactFlow;

if (require.main === module) {
    console.log("called directly");
    if (process.argv.length < 3)
        usageExit();
    try {
        var data = JSON.parse(process.argv[2]);
    } catch (error) {
        console.error('Invalid JSON', error);
        usageExit();
    }
    createContactFlow(data, function (err, res) {
        console.log("Result", err, res);
    });
}

function usageExit() {
    console.error('Usage: ' + path.basename(process.argv[1]) + ' json-array');
    process.exit(1);
}