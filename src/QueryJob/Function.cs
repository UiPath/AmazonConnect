using Amazon.Lambda;
using Amazon.Lambda.Core;
using Amazon.Lambda.Model;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.Json.JsonSerializer))]

namespace QueryJob
{
    public class JsonHelper
    {
        public static Dictionary<string, object> DeserializeAndFlatten(string json)
        {
            Dictionary<string, object> dict = new Dictionary<string, object>();
            JToken token = JToken.Parse(json);
            FillDictionaryFromJToken(dict, token, "");
            return dict;
        }

        private static void FillDictionaryFromJToken(Dictionary<string, object> dict, JToken token, string prefix)
        {
            switch (token.Type)
            {
                case JTokenType.Object:
                    foreach (JProperty prop in token.Children<JProperty>())
                    {
                        FillDictionaryFromJToken(dict, prop.Value, Join(prefix, prop.Name));
                    }
                    break;

                case JTokenType.Array:
                    int index = 0;
                    foreach (JToken value in token.Children())
                    {
                        FillDictionaryFromJToken(dict, value, Join(prefix, index.ToString()));
                        index++;
                    }
                    break;

                default:
                    dict.Add(prefix, ((JValue)token).Value);
                    break;
            }
        }

        private static string Join(string prefix, string name)
        {
            return (string.IsNullOrEmpty(prefix) ? name : prefix + name);
        }
    }

    public class QueryJobFunctionInput
    {
        public string AccessToken { get; set; }
        public string ClientId { get; set; }
        public string UserKey { get; set; }
        public string AccountName { get; set; }
        public string TenantName { get; set; }
        public int OrganizationUnitId { get; set; }
        public Guid JobKey { get; set; }
        public bool RequestNewToken { get; set; }

        public QueryJobFunctionInput(JObject jsonInput)
        {
            JToken accessToken = jsonInput["Details"]["ContactData"]["Attributes"]["AccessToken"];
            JToken clientId = jsonInput["Details"]["Parameters"]["clientId"];
            JToken userKey = jsonInput["Details"]["Parameters"]["userKey"];
            JToken accountName = jsonInput["Details"]["Parameters"]["accountName"];
            JToken tenantName = jsonInput["Details"]["Parameters"]["tenantName"];
            JToken organizationUnitId = jsonInput["Details"]["Parameters"]["organizationUnitId"];
            JToken jobKey = jsonInput["Details"]["Parameters"]["jobKey"];

            if (accessToken != null)
            {
                AccessToken = accessToken.ToString();
                ClientId = null;
                UserKey = null;
            }
            else
            {
                AccessToken = null;
                ClientId = clientId != null ? clientId.ToString() : throw new ArgumentNullException(nameof(clientId));
                UserKey = userKey != null ? userKey.ToString() : throw new ArgumentNullException(nameof(userKey));
            }

            AccountName = accountName != null ? accountName.ToString() : throw new ArgumentNullException(nameof(accountName));
            TenantName = tenantName != null ? tenantName.ToString() : throw new ArgumentNullException(nameof(tenantName));
            JobKey = !jobKey.ToString().Equals(Guid.Empty) ? new Guid(jobKey.ToString()) : throw new ArgumentNullException(nameof(jobKey));

            OrganizationUnitId = (organizationUnitId != null) ? Convert.ToInt32(organizationUnitId.ToString()) : throw new ArgumentNullException(nameof(organizationUnitId));

            var parsedToken = jsonInput["Details"]["Parameters"]["requestNewToken"];
            RequestNewToken = (parsedToken != null) ? Convert.ToBoolean(parsedToken.ToString()) : false;
        }
    }

    public class QueryJobFunctionOutput
    {
        public Guid JobKey { get; set; }
        public string State { get; set; }
        public string Info { get; set; }
        public JObject OutputArguments { get; set; }

        public QueryJobFunctionOutput(Guid jobKey, string state, string info, string outputAguments)
        {
            JobKey = jobKey;
            State = state;
            Info = info;
            OutputArguments = !String.IsNullOrEmpty(outputAguments) ? JObject.Parse(outputAguments) : null;
        }
    }

    public class Function
    {
        private static Dictionary<string, string> AccessTokens = new Dictionary<string, string>();

        //public async Task<QueryJobFunctionOutput> FunctionHandler(JObject jsonInput, ILambdaContext context)
        public async Task<JObject> FunctionHandler(JObject jsonInput, ILambdaContext context)
        {
            context.Logger.LogLine("JSON Inputs: " + jsonInput.ToString());
            QueryJobFunctionInput input = new QueryJobFunctionInput(jsonInput);

            string accessToken = input.AccessToken;
            if (input.RequestNewToken)
            {
                context.Logger.LogLine("Clearing access token");
                AccessTokens.Remove(input.ClientId);
                accessToken = null;
            }

            if (String.IsNullOrEmpty(accessToken))
            {
                if (!AccessTokens.TryGetValue(input.ClientId, out accessToken))
                {
                    context.Logger.LogLine("Requesting new access Token...");

                    AmazonLambdaClient client = new AmazonLambdaClient();
                    InvokeRequest ir = new InvokeRequest
                    {
                        FunctionName = "UiPathOrchestratorAuthenticate",
                        InvocationType = InvocationType.RequestResponse,
                        Payload = JsonConvert.SerializeObject(jsonInput, Formatting.Indented)
                    };
                    InvokeResponse invokeResponse = await client.InvokeAsync(ir);
                    if (invokeResponse.HttpStatusCode == System.Net.HttpStatusCode.OK)
                    {
                        var sr = new StreamReader(invokeResponse.Payload);
                        string response = sr.ReadToEnd();
                        var authResponse = JsonConvert.DeserializeObject<JObject>(response);
                        accessToken = authResponse["AccessToken"].ToString();
                        AccessTokens.Add(input.ClientId, accessToken);
                        context.Logger.LogLine("Access Token: " + accessToken);
                    }
                    else
                    {
                        context.Logger.LogLine("Authentication failed");
                        AccessTokens.Remove(input.ClientId);
                        throw new ApplicationException("Unable to authenticate: " + invokeResponse.FunctionError);
                    }
                }
                else
                {
                    context.Logger.LogLine("Existing Access Token: " + accessToken);
                }
            }

            string platformEndpoint = System.Environment.GetEnvironmentVariable("PlatformURL");
            var getReleaseUrl = String.Format("{0}/{1}/{2}/odata/Jobs?$filter=(Key eq {3})", platformEndpoint, input.AccountName, input.TenantName, input.JobKey);

            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                httpClient.DefaultRequestHeaders.Add("X-UIPATH-TenantName", input.TenantName);
                httpClient.DefaultRequestHeaders.Add("X-UIPATH-OrganizationUnitId", input.OrganizationUnitId.ToString());

                context.Logger.LogLine("Getting the Job status ...");
                var response = await httpClient.GetAsync(getReleaseUrl);
                if (response.IsSuccessStatusCode)
                {
                    string result = response.Content.ReadAsStringAsync().Result;

                    dynamic data = JObject.Parse(result);
                    string state = data.value[0].State;
                    string info = data.value[0].Info;
                    string outputArguments = data.value[0].OutputArguments;

                    var outputObject = new QueryJobFunctionOutput(input.JobKey, state, info, outputArguments);
                    var jsonString = JsonConvert.SerializeObject(outputObject);
                    context.Logger.LogLine("Pre-Flatten JSON:" + jsonString);

                    Dictionary<string, object> flattenedDictionary = JsonHelper.DeserializeAndFlatten(jsonString);

                    var outputString = "{" + string.Join(',', flattenedDictionary.Select(x => String.Format("\"{0}\" : \"{1}\"", x.Key, x.Value)).ToArray()) + "}";
                    var output = JObject.Parse(outputString);
                    return output;
                }
                else
                {
                    context.Logger.LogLine("Failed to get job status");
                    throw new ApplicationException(response.ReasonPhrase);
                }
            }
        }
    }
}
