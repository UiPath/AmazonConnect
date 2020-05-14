module.exports = function (instrumentationKey) {
    let appInsights = require("applicationinsights");
    appInsights.setup(instrumentationKey)
        .setAutoCollectExceptions(true)
        .setAutoCollectConsole(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectRequests(false)
        .setAutoCollectDependencies(false)
        .setAutoDependencyCorrelation(false)
        .start();
    
    const client = appInsights.defaultClient;
    client.config.maxBatchIntervalMs = 0
    return client;
}