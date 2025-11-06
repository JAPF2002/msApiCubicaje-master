const express = require('express');
const ctrl = require('./controller');
const response = require('../../../utils/response');

const router = express.Router();

router.get('/', function (req, res) {
    ctrl.list()
        .then((data) => response.success(req, res, data))
        .catch((err) => response.error(req, res, err))
})

router.get('/:id', function (req, res) {
    ctrl.get(req.params.id)
        .then((data) => response.success(req, res, data))
        .catch((err) => response.error(req, res, err))
})

router.post('/', function (req, res) {
    ctrl.insert(req.body)
        .then((data) => response.success(req, res, data))
        .catch((err) => response.error(req, res, err))
})

router.put('/', function (req, res) {
    ctrl.update(req.body)
        .then((data) => response.success(req, res, data))
        .catch((err) => response.error(req, res, err))
})

router.delete('/:id', function (req, res) {
    ctrl.remove(req.params.id)
        .then((data) => response.success(req, res, data))
        .catch((err) => response.error(req, res, err))
})

module.exports = router;
