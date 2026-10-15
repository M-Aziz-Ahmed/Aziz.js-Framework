// Legacy (req, res) style handler
module.exports = function (req, res) {
    res.status(200).json({ legacy: true, method: req.method });
};
