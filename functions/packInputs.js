exports.handler = async (event) => {
    const inputParams = JSON.stringify(event['Details']['Parameters']);
    const response = { inputParams };
    return response;
};