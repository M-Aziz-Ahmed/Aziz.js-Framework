module.exports = {
    GET: async (request) => ({ parts: request.params.path }),
};
