var mongoose = require('mongoose');
var User = require('../models/user.js');
var Task = require('../models/task.js');
var helpers = require('./helpers.js');
var HttpError = helpers.HttpError;

// Validate and normalize a POST/PUT body. Throws 400 on bad input.
function readUserBody(req) {
    var body = req.body || {};
    var name = body.name, email = body.email, pendingTasks = body.pendingTasks;

    if (typeof name !== 'string' || name.trim() === '') {
        throw HttpError(400, 'A user must have a name');
    }
    if (typeof email !== 'string' || email.trim() === '') {
        throw HttpError(400, 'A user must have an email');
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        throw HttpError(400, 'The email address is not valid');
    }

    if (pendingTasks === undefined || pendingTasks === null) {
        pendingTasks = [];
    } else if (typeof pendingTasks === 'string' && req.is('application/x-www-form-urlencoded')) {
        // A form body sends a single value as a plain string
        pendingTasks = pendingTasks === '' ? [] : [pendingTasks];
    }
    if (!Array.isArray(pendingTasks)) {
        throw HttpError(400, 'pendingTasks must be a list of task ids');
    }
    pendingTasks.forEach(function (taskId) {
        if (!helpers.isObjectId(taskId)) {
            throw HttpError(400, 'pendingTasks contains an invalid task id', taskId);
        }
    });

    return {
        name: name.trim(),
        email: email.trim(),
        pendingTasks: Array.from(new Set(pendingTasks))
    };
}

// Check the referenced tasks and other users. Throws 400/404 on conflicts.
async function checkUserReferences(fields, userId) {
    var emailFilter = { email: fields.email };
    if (userId) emailFilter._id = { $ne: userId };
    if (await User.exists(emailFilter)) {
        throw HttpError(400, 'A user with this email already exists');
    }

    var tasks = await Task.find({ _id: { $in: fields.pendingTasks } });
    if (tasks.length !== fields.pendingTasks.length) {
        var found = tasks.map(function (t) { return t._id.toString(); });
        var missing = fields.pendingTasks.filter(function (id) { return found.indexOf(id) === -1; });
        throw HttpError(404, 'Some tasks in pendingTasks do not exist', missing);
    }
    var completed = tasks.filter(function (t) { return t.completed; });
    if (completed.length) {
        throw HttpError(400, 'Completed tasks cannot be pending', completed.map(function (t) { return t._id; }));
    }
}

// Write the user and keep its tasks in sync (oldPending is [] for a new user)
async function saveUser(userId, fields, oldPending, isNew) {
    await helpers.inTransaction(async function (session) {
        if (isNew) {
            await User.create([Object.assign({ _id: userId }, fields)], { session: session });
        } else {
            await User.updateOne({ _id: userId }, fields, { session: session, runValidators: true });
        }

        var removed = oldPending.filter(function (id) { return fields.pendingTasks.indexOf(id) === -1; });
        if (removed.length) {
            await Task.updateMany({ _id: { $in: removed }, assignedUser: userId },
                { assignedUser: '', assignedUserName: 'unassigned' }, { session: session });
        }

        if (fields.pendingTasks.length) {
            // Tasks taken from another user leave that user's pendingTasks
            await User.updateMany({ _id: { $ne: userId }, pendingTasks: { $in: fields.pendingTasks } },
                { $pull: { pendingTasks: { $in: fields.pendingTasks } } }, { session: session });
            await Task.updateMany({ _id: { $in: fields.pendingTasks } },
                { assignedUser: userId, assignedUserName: fields.name }, { session: session });
        }

        // Keep the name on all of the user's tasks (completed ones too) up to date
        await Task.updateMany({ assignedUser: userId }, { assignedUserName: fields.name }, { session: session });
    });
    return User.findById(userId);
}

// Look up the user named in the URL. Malformed and unknown ids are both 404.
async function findUserOr404(id, select) {
    var user = helpers.isObjectId(id) ? await User.findById(id).select(select || {}) : null;
    if (!user) throw HttpError(404, 'User not found');
    return user;
}

module.exports = function (router) {

    var usersRoute = router.route('/users');

    usersRoute.get(function (req, res) {
        return helpers.listHandler(User, 0, req, res);
    });

    usersRoute.post(async function (req, res) {
        var fields = readUserBody(req);
        await checkUserReferences(fields, null);
        var userId = new mongoose.Types.ObjectId().toString();
        var user = await saveUser(userId, fields, [], true);
        res.status(201).json({ message: 'User created', data: user });
    });

    var userRoute = router.route('/users/:id');

    userRoute.get(async function (req, res) {
        var select = helpers.parseSelect(req.query);
        var user;
        try {
            user = await findUserOr404(req.params.id, select);
        } catch (err) {
            if (err.name === 'MongoServerError') throw HttpError(400, 'Invalid "select" parameter');
            throw err;
        }
        res.status(200).json({ message: 'OK', data: user });
    });

    userRoute.put(async function (req, res) {
        var existing = await findUserOr404(req.params.id);
        var fields = readUserBody(req);
        await checkUserReferences(fields, existing._id);
        var user = await saveUser(existing._id.toString(), fields, existing.pendingTasks, false);
        res.status(200).json({ message: 'User updated', data: user });
    });

    userRoute.delete(async function (req, res) {
        var user = await findUserOr404(req.params.id);
        var userId = user._id.toString();
        await helpers.inTransaction(async function (session) {
            await Task.updateMany({ $or: [{ assignedUser: userId }, { _id: { $in: user.pendingTasks } }] },
                { assignedUser: '', assignedUserName: 'unassigned' }, { session: session });
            await User.deleteOne({ _id: userId }, { session: session });
        });
        res.status(200).json({ message: 'User deleted', data: user });
    });

    return router;
};
