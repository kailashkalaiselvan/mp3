var mongoose = require('mongoose');
var User = require('../models/user.js');
var Task = require('../models/task.js');
var helpers = require('./helpers.js');
var HttpError = helpers.HttpError;

// Accept real booleans and the strings "true"/"false" (form bodies)
function readBoolean(value) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return undefined;
}

// Validate and normalize a POST/PUT body. Throws 400 on bad input.
function readTaskBody(req) {
    var body = req.body || {};

    if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw HttpError(400, 'A task must have a name');
    }

    var deadline = body.deadline;
    if (deadline === undefined || deadline === null || deadline === '') {
        throw HttpError(400, 'A task must have a deadline');
    }
    if (typeof deadline === 'string' && /^\d+$/.test(deadline)) deadline = Number(deadline);
    if ((typeof deadline !== 'string' && typeof deadline !== 'number') || isNaN(new Date(deadline).getTime())) {
        throw HttpError(400, 'The deadline is not a valid date');
    }

    var description = body.description;
    if (description === undefined || description === null) description = '';
    if (typeof description !== 'string') {
        throw HttpError(400, 'The description must be text');
    }

    var completed = false;
    if (body.completed !== undefined && body.completed !== null) {
        completed = readBoolean(body.completed);
        if (completed === undefined) throw HttpError(400, 'completed must be true or false');
    }

    var assignedUser = body.assignedUser;
    if (assignedUser === undefined || assignedUser === null) assignedUser = '';
    if (typeof assignedUser !== 'string' || (assignedUser !== '' && !helpers.isObjectId(assignedUser))) {
        throw HttpError(400, 'assignedUser is not a valid user id');
    }

    var assignedUserName = body.assignedUserName;
    if (assignedUserName === null) assignedUserName = undefined;
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        throw HttpError(400, 'assignedUserName must be text');
    }
    if (assignedUser === '') {
        if (assignedUserName !== undefined && assignedUserName !== '' && assignedUserName !== 'unassigned') {
            throw HttpError(400, 'assignedUserName must be "unassigned" when the task has no assignedUser');
        }
        assignedUserName = 'unassigned';
    }

    return {
        name: body.name.trim(),
        description: description,
        deadline: new Date(deadline),
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

// Check the assigned user exists and matches assignedUserName. Fills in the name.
async function checkTaskReferences(fields) {
    if (fields.assignedUser === '') return;
    var user = await User.findById(fields.assignedUser);
    if (!user) throw HttpError(404, 'The assigned user does not exist');
    if (fields.assignedUserName === undefined) {
        fields.assignedUserName = user.name;
    } else if (fields.assignedUserName !== user.name) {
        throw HttpError(400, 'assignedUserName does not match the name of assignedUser');
    }
}

// Write the task and keep users' pendingTasks in sync
async function saveTask(taskId, fields, isNew) {
    await helpers.inTransaction(async function (session) {
        if (isNew) {
            await Task.create([Object.assign({ _id: taskId }, fields)], { session: session });
        } else {
            await Task.updateOne({ _id: taskId }, fields, { session: session, runValidators: true });
        }
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session: session });
        if (fields.assignedUser !== '' && !fields.completed) {
            await User.updateOne({ _id: fields.assignedUser }, { $addToSet: { pendingTasks: taskId } }, { session: session });
        }
    });
    return Task.findById(taskId);
}

// Look up the task named in the URL. Malformed and unknown ids are both 404.
async function findTaskOr404(id, select) {
    var task = helpers.isObjectId(id) ? await Task.findById(id).select(select || {}) : null;
    if (!task) throw HttpError(404, 'Task not found');
    return task;
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    tasksRoute.get(function (req, res) {
        return helpers.listHandler(Task, 100, req, res);
    });

    tasksRoute.post(async function (req, res) {
        var fields = readTaskBody(req);
        await checkTaskReferences(fields);
        var taskId = new mongoose.Types.ObjectId().toString();
        var task = await saveTask(taskId, fields, true);
        res.status(201).json({ message: 'Task created', data: task });
    });

    var taskRoute = router.route('/tasks/:id');

    taskRoute.get(async function (req, res) {
        var select = helpers.parseSelect(req.query);
        var task;
        try {
            task = await findTaskOr404(req.params.id, select);
        } catch (err) {
            if (err.name === 'MongoServerError') throw HttpError(400, 'Invalid "select" parameter');
            throw err;
        }
        res.status(200).json({ message: 'OK', data: task });
    });

    taskRoute.put(async function (req, res) {
        var existing = await findTaskOr404(req.params.id);
        var fields = readTaskBody(req);
        await checkTaskReferences(fields);
        var task = await saveTask(existing._id.toString(), fields, false);
        res.status(200).json({ message: 'Task updated', data: task });
    });

    taskRoute.delete(async function (req, res) {
        var task = await findTaskOr404(req.params.id);
        var taskId = task._id.toString();
        await helpers.inTransaction(async function (session) {
            await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session: session });
            await Task.deleteOne({ _id: taskId }, { session: session });
        });
        res.status(204).end();
    });

    return router;
};
