// Load required packages
var mongoose = require('mongoose');

// Define our task schema
var TaskSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    deadline: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    assignedUser: { type: String, default: '' },
    assignedUserName: { type: String, default: 'unassigned' },
    dateCreated: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

// Export the Mongoose model
module.exports = mongoose.model('Task', TaskSchema);
