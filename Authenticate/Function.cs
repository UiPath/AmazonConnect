using Amazon.Lambda.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.Json.JsonSerializer))]

namespace Authenticate
{
    public class AuthenticateFunctionInput
    {
        public AuthenticateFunctionInput(string clientId, string userKey, bool requestNewToken = false)
        {
            ClientId = clientId ?? throw new ArgumentNullException(nameof(clientId));
            UserKey = userKey ?? throw new ArgumentNullException(nameof(userKey));
            RequestNewToken = requestNewToken;
        }

        public string ClientId { get; set; }
        public string UserKey { get; set; }
        public bool RequestNewToken { get; set; }
    }

    public class AuthenticateFunctionOutput
    {
        public string AccessToken { get; set; }
    }

    class AuthenticationBody
    {
        public string grant_type = "refresh_token";
        public string client_id { get; set; }
        public string refresh_token { get; set; }

        public AuthenticationBody(string clientId, string userKey)
        {
            this.client_id = clientId ?? throw new ArgumentNullException(nameof(clientId));
            this.refresh_token = userKey ?? throw new ArgumentNullException(nameof(userKey));
        }
    }

    public class Function
    {
        private static Dictionary<string, string> AccessTokens = new Dictionary<string, string>();

        public async Task<AuthenticateFunctionOutput> FunctionHandler(JObject jsonInput, ILambdaContext context)
        {
            string clientID = jsonInput["Details"]["Parameters"]["clientId"].ToString();
            string userKey = jsonInput["Details"]["Parameters"]["userKey"].ToString();
            var parsedToken = jsonInput["Details"]["Parameters"]["requestNewToken"];
            bool requestNewToken = (parsedToken!=null) ? Convert.ToBoolean(parsedToken.ToString()) : false;
            AuthenticateFunctionInput input = new AuthenticateFunctionInput(clientID, userKey, requestNewToken);

            if (input.RequestNewToken)
            {
                context.Logger.LogLine("Clearing access token");
                AccessTokens.Remove(input.ClientId);
            }

            string accessToken = null;
            if (!AccessTokens.TryGetValue(input.ClientId, out accessToken))
            {
                context.Logger.LogLine("Requesting new access Token...");
                var authBody = new AuthenticationBody(input.ClientId, input.UserKey);
                var json = JsonConvert.SerializeObject(authBody);
                var data = new StringContent(json, Encoding.UTF8, "application/json");
                var authenticationUrl = "https://account.uipath.com/oauth/token";

                using (var httpClient = new HttpClient())
                {
                    var response = await httpClient.PostAsync(authenticationUrl, data);
                    if (response.IsSuccessStatusCode)
                    {
                        string result = response.Content.ReadAsStringAsync().Result;

                        dynamic jsonData = JObject.Parse(result);

                        accessToken = jsonData.access_token;
                        AccessTokens.Add(input.ClientId, accessToken);
                        context.Logger.LogLine("Access Token: " + accessToken);
                    }
                    else
                    {
                        context.Logger.LogLine("Clearing access token");
                        AccessTokens.Remove(input.ClientId);
                        throw new ApplicationException(response.ReasonPhrase);
                    }
                }
            }
            else
            {
                context.Logger.LogLine("Existing Access Token: " + accessToken);
            }

            AuthenticateFunctionOutput output = new AuthenticateFunctionOutput {
                AccessToken = accessToken
            };
            context.Logger.LogLine("Output:" + JsonConvert.SerializeObject(output));
            return output;
        }
    }
}
