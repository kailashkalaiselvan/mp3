// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Connect to a MongoDB --> Uncomment this once you have a connection string!!
mongoose.connect(process.env.MONGODB_URI).catch(function (err) { console.error('MongoDB connection error:', err.message); });

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

// Anything that did not match a route
app.use(function (req, res) {
    res.status(404).json({ message: 'Endpoint not found', data: null });
});

// Turn errors into {message, data} responses without leaking database details
app.use(function (err, req, res, next) {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: 'The request body is not valid JSON', data: null });
    }
    if (err.code === 11000) {
        return res.status(400).json({ message: 'A user with this email already exists', data: null });
    }
    if (err.name === 'ValidationError' || err.name === 'CastError') {
        return res.status(400).json({ message: 'The request contains invalid values', data: null });
    }
    if (err.status) {
        return res.status(err.status).json({ message: err.message, data: err.data });
    }
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on the server', data: null });
});

// Start the server
app.listen(port);
console.log('Server running on port ' + port);
