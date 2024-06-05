const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
    console.log('Connected to MongoDB');
});

app.get('/', (req, res) => {
    res.send('Welcome to the Werewolves Game Backend!');
});

// Placeholder for API routes
// const rolesRouter = require('./routes/roles');
// const tempAttributesRouter = require('./routes/tempAttributes');
// app.use('/api/roles', rolesRouter);
// app.use('/api/temp-attributes', tempAttributesRouter);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
