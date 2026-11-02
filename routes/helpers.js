/*
 * Shared helpers for the users and tasks endpoints.
 */
var mongoose = require('mongoose');

// An error that the error handler turns into a {message, data} response
function HttpError(status, message, data) {
    var err = new Error(message);
    err.status = status;
    err.data = data === undefined ? null : data;
    return err;
}

// Strict check for a 24-character hex ObjectId
function isObjectId(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

// Parse a JSON-encoded query parameter that must be an object (where, sort, select)
function parseObjectParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    var value;
    try {
        if (typeof raw !== 'string') throw new Error();
        value = JSON.parse(raw);
    } catch (e) {
        throw HttpError(400, 'Invalid "' + name + '" parameter: it must be valid JSON');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw HttpError(400, 'Invalid "' + name + '" parameter: it must be a JSON object');
    }
    return value;
}

// Parse a non-negative integer query parameter (skip, limit)
function parseIntParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) {
        throw HttpError(400, 'Invalid "' + name + '" parameter: it must be a non-negative integer');
    }
    return parseInt(raw, 10);
}

// Read the select parameter ("filter" is accepted as an older alias)
function parseSelect(query) {
    var select = parseObjectParam(query, 'select');
    return select !== undefined ? select : parseObjectParam(query, 'filter');
}

// GET handler for a collection: where, sort, select, skip, limit, count
async function listHandler(Model, defaultLimit, req, res) {
    var where = parseObjectParam(req.query, 'where') || {};
    var sort = parseObjectParam(req.query, 'sort');
    var select = parseSelect(req.query);
    var skip = parseIntParam(req.query, 'skip');
    var limit = parseIntParam(req.query, 'limit');
    var count = req.query.count === 'true' || req.query.count === '1';

    try {
        if (count) {
            var countQuery = Model.countDocuments(where);
            if (skip !== undefined) countQuery.skip(skip);
            if (limit !== undefined) countQuery.limit(limit);
            return res.status(200).json({ message: 'OK', data: await countQuery });
        }

        var query = Model.find(where);
        if (sort) query.sort(sort);
        if (select) query.select(select);
        if (skip !== undefined) query.skip(skip);
        if (limit === undefined) limit = defaultLimit;
        if (limit) query.limit(limit);
        res.status(200).json({ message: 'OK', data: await query });
    } catch (err) {
        // Bad values inside where/sort/select (e.g. a malformed _id or mixed projection)
        if (err instanceof mongoose.Error.CastError || err.name === 'MongoServerError') {
            throw HttpError(400, 'Invalid query parameters');
        }
        throw err;
    }
}

// Run fn(session) inside a transaction so related documents change together or not at all
async function inTransaction(fn) {
    var session = await mongoose.startSession();
    try {
        var result;
        await session.withTransaction(async function () {
            result = await fn(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

module.exports = {
    HttpError: HttpError,
    isObjectId: isObjectId,
    parseSelect: parseSelect,
    listHandler: listHandler,
    inTransaction: inTransaction
};
