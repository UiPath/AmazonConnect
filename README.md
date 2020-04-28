# Amazon Connect powered by UiPath
## Fulfill Amazon Connect contact flows with unattended UiPath automation

![Continuous Integration](https://github.com/UiPath/AWSLambda/workflows/Continuous%20Integration/badge.svg)

IVR (“Interactive Voice Response”) systems are often the first point of contact for customers as part of an enterprise’s contact care system.  Unfortunately, IVRs often fall short on the promise of providing “self-service” solutions for customers as IVRs are only capable of connecting to systems that are accessible via API, which even when available can be expensive to implement such solutions.

With UiPath’s Robotic Process Automation (RPA) platform, Amazon Connect can be connected to any system via RPA, drastically expanding IVR fulfillment capabilities to gather information and perform actions across a plethora of systems from on-prem mainframes to cloud-based web services. Increasing the success rate of customer requests being fulfilled by the self-service IVR frees your contact center agents up to work on more complex customer issues. The results? Improved customer and employee experiences, enhanced accuracy, reduced Average Handling Time (“AHT”), and acceleration of customers’ digital transformation initiatives, resulting in a rapid return on investment.

![Architecture Diagram](./.github/Architecture.png "Integration Architecture")

This repro contains everything you need to quickly incorporate UiPath automation into your Amazon Connect contact flows.
- AWS Lambda functions
- Sample Inbound and Outbound Amazon Connect Contact Flows
- Sample Processes

## Deployment Steps
### Step 1. Prepare an Amazon Connect instance
1. Sign in to your AWS account at https://aws.amazon.com with an AWS Identity and
Access Management (IAM) user role that has the necessary permissions.
2. If you don’t already have an Amazon Connect instance, see the [AWS documentation](https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-get-started.html) for information on how to create an Amazon Connect instance.

### Step 2. Create & configure your UiPath Cloud instance
1. Create a [new UiPath cloud instance](https://platform.uipath.com/portal_/register), or [use an existing instace](https://cloud.uipath.com)
2. Download the sample processes [in this repo](./tree/master/processes), or use your own processes
 - Inbound Demo
   - BillLookup - an unattended automation that takes a phone number as input and returns the last monthly bill details
 - Outbound Demo
   - OutboundLauncher - an attended automation that takes an Excel spreadsheet as input and initiates an outgoing call to each customer in the file using Amazon Connect
   - UpdateSpreadsheet - an unattended automation that social security number for a given record matching a phone number in an Excel spreadsheet
3. Publish the processes from Studio to Orchestrator - [HowTo](https://docs.uipath.com/orchestrator/docs/publishing-a-project-from-studio-to-orchestrator)
4. Deploy the processes - [HowTo](https://docs.uipath.com/orchestrator/docs/managing-processes)
5. Generate a user key and client ID for your cloud instance - [HowTo](https://docs.uipath.com/cloudplatform/docs/about-api-access)
6. Note down the following information as it will be needed in later steps:
   - User Key
   - Client Id
   - Account logical name
   - Tenant logical name 

### Step 3. Create lambda functions
AWS Lambda functions will be the glue that connect Amazon Connect and UiPath.  There are two primary lambda functions:
   - UiPathOrchestratorStartJob - Queue a UiPath automation job, with inputs
   - UiPathOrchestratorQueryJob - Check the status of a job

And three helper lambda functions:
   - UiPathPackInputs - Package the inputs from Amazon Connect into a JSON packet
   - UiPathOrchestratorQueryReleaseKey - Get the release key guid for a given process name
   - UiPathOrchestratorAuthenticate - Get an access token for interacting with the UiPath Cloud Orchestrator

1. Open the [AWS Lambda console](https://console.aws.amazon.com/lambda/home)
2. Set the region to the same region as your Amazon Connect instance.  *NOTE: Amazon Connect only supports using lambda functions in the same region as your contact center.*
3. Download the UiPath AWS Lambda function deplyoment packages [from the release tab on this repo](./releases), or edit the source code and build your own using the documentation on [building Lambda Functions with C#](https://docs.aws.amazon.com/lambda/latest/dg/lambda-csharp.html)
4. [Create 5 new AWS Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/getting-started-create-function.html) and upload the related code package you downloaded above:

| Function name                     | Runtime       | Package                   | Handler                                                    |
|-----------------------------------|---------------|---------------------------|------------------------------------------------------------|
| UiPathOrchestratorAuthenticate    | .NET Core 3.1 | UiPathAuthenticate.zip    | Authenticate::Authenticate.Function::FunctionHandler       |
| UiPathOrchestratorQueryReleaseKey | .NET Core 3.1 | UiPathQueryReleaseKey.zip | QueryReleaseKey::QueryReleaseKey.Function::FunctionHandler |
| UiPathOrchestratorStartJob        | .NET Core 3.1 | UiPathStartJob.zip        | StartJob::StartJob.Function::FunctionHandler               |
| UiPathOrchestratorQueryJob        | .NET Core 3.1 | UiPathQueryJob.zip        | QueryJob::QueryJob.Function::FunctionHandler               |
| UiPathPackInputs                  | Node.js 12.x  | See code below  | index.handler              |

#### UiPathPackInputs code
```exports.handler = async (event) => {
    const inputParams =  JSON.stringify(event['Details']['Parameters']);
    const response ={inputParams};
    return response;
};
```    

### Step 4. Create the contact flows in Amazon Connect
1. Add the Lambda Functions to Your Amazon Connect Instance by following the [AWS documentation](https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html#add-lambda-function).  Specifically, you need to add UiPathOrchestratorStartJob and UiPathOrchestratorQueryJob.
2. Download the sample contact flows [in this repo](./tree/master/contactflows)
3. Import the sample contact flows into Amazon Connect by following the [Amazon Connect documentation](https://docs.aws.amazon.com/connect/latest/adminguide/contact-flow-import-export.html)
4. Change...
Change values:
Account
Tenant
Client Key
USer Key

### Step 5. Configure & test your flows 




3.	Create contact flow for phone and/or chat
a.	https://aws.amazon.com/connect/
b.	Link Lambdas
c.	Sample Contact Flows

To post feedback, submit feature ideas, or report bugs, use the Issues section of this GitHub repo.