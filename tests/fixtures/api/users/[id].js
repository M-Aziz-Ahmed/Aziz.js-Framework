module.exports = {
    GET: async (request) => ({ id: request.params.id }),
    DELETE: async (request) => ({ deleted: request.params.id }),
};
