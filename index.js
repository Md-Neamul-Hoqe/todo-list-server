require('dotenv').config()
const express = require('express');
const cors = require('cors');
const jsonwebtoken = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// const stripe = require("stripe")(process.env.Payment_SECRET);

/* All require statements must in top portion to access desired components / functions */

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
// console.log('Secret: ', process.env.Payment_SECRET);

const app = express();


app.use(cors({
    origin: [ "http://localhost:5173", "https://to-do-mnh.web.app" ],
    credentials: true
}));
app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const db = client.db(process.env.DB_NAME);
        const taskCollection = db.collection('tasks');
        const notificationCollection = db.collection('notifications');
        const userCollection = db.collection('users');

        /**
         * ===================================================
         *  Auth APIs 
         * ===================================================
         * */

        /* Middleware JWT implementation */
        const verifyToken = async (req, res, next) => {
            try {
                // console.log('the token to be verified: ', req?.cookies);
                const token = req?.cookies?.[ "to-do-list" ];
                // console.log('token from browser cookie: ', token);

                if (!token) return res.status(401).send({ message: 'Unauthorized access' })

                jsonwebtoken.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                    // console.log(err);
                    if (err) {
                        // console.log(err);
                        return res.status(401).send({ message: 'You are not authorized' })
                    }

                    // console.log('Decoded token: ', decoded);
                    req.user = decoded;
                    next();
                })
            } catch (error) {
                // console.log(error);
                res.status(500).send({ message: error?.message || error?.errorText });
            }
        }

        const setTokenCookie = async (req, res, next) => {
            const user = req?.body;

            if (user?.email) {
                const token = jsonwebtoken.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '24h' })

                // console.log('Token generated: ', token);
                res
                    .cookie('to-do-list', token, {
                        httpOnly: true,
                        secure: true,
                        sameSite: 'none'
                    })

                req[ "to-do-list" ] = token;

                // console.log('Token Created: ', req[ "to-do-list" ]);
                next();
            }
        }

        /* Create JWT */
        app.post('/api/v1/auth/jwt', setTokenCookie, (req, res) => {
            try {
                const token = req[ "to-do-list" ];

                // console.log('token in cookie: ', token);

                if (!token) return res.status(400).send({ success: false, message: 'Unknown error occurred' })

                // console.log('User sign in successfully.');
                res.send({ success: true })
            } catch (error) {
                res.send({ error: true, message: error.message })
            }

        })

        /* clear cookie / token of logout user */
        app.post('/api/v1/user/logout', (_req, res) => {
            try {
                res.clearCookie('to-do-list', { maxAge: 0 }).send({ success: true })
            } catch (error) {
                res.status(500).send({ error: true, message: error.message })
            }
        })

        /**
         * ============================================
         * Users APIs
         * ============================================
         */
        app.post('/api/v1/create-user', async (req, res) => {
            try {
                const user = req.body;
                // console.log('User created: ',user);

                const query = { email: user?.email }
                const existingUser = await userCollection.findOne(query);

                // console.log('is Existing User: ', existingUser);

                if (existingUser)
                    return res.send({ message: `Welcome back ${existingUser?.name}${existingUser?.role ? ' as ' + existingUser?.role : 'user.'}`, insertedId: null })


                const result = await userCollection.insertOne(user)
                res.send(result)
            } catch (error) {
                res.status(500).send({ error: true, message: error.message })
            }
        })

        /**
         * ================================================================
         * TASK APIs
         * ================================================================
         */

        /* Create a task */
        app.post('/api/v1/create-task', verifyToken, async (req, res) => {
            try {
                const task = req.body;
                const result = await taskCollection.insertOne(task)

                // console.log('Task created: ',result);

                res.send(result)
            } catch (error) {
                console.log('Error creating task: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /* Get all tasks */
        app.get('/api/v1/tasks', verifyToken, async (req, res) => {
            try {
                const email = req.query?.email;
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                const tasks = await taskCollection.aggregate([
                    {
                        $match: {
                            status: { $ne: "completed" }, // Exclude documents where status is "complete"
                            email: { $eq: email }
                        }
                    },
                    {
                        $sort: { status: -1, date: 1 }
                    },
                ]).toArray();


                // console.log(tasks);

                res.send(tasks)
            } catch (error) {
                console.log('Error getting tasks: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /* Get all completed tasks */
        app.get('/api/v1/completed-tasks', verifyToken, async (req, res) => {
            try {
                const email = req.query?.email;
                let query = { status: { $eq: 'completed' } }
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                query.email = email;

                const result = await taskCollection.find(query).toArray();
                // console.log('Get completed task: ',result);
                res.send(result)
            } catch (error) {
                console.log(error);
            }
        })

        /* Get all running tasks */
        app.get('/api/v1/running-tasks', verifyToken, async (_req, res) => {
            try {
                const result = await taskCollection.aggregate([
                    {
                        $match: {
                            status: "running"
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            titles: {
                                $push: "$title"
                            },
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            count: 1,
                            titles: {
                                $reduce: {
                                    input: "$titles",
                                    initialValue: "",
                                    in: {
                                        $concat: [ "$$value", { $cond: [ { $eq: [ "$$value", "" ] }, "", ", " ] }, "$$this" ]
                                    }
                                }
                            }
                        }
                    }
                ]).toArray()

                // console.log('Get running task: ',result);

                res.send(...result)
            } catch (error) {
                console.log(error);
            }
        })

        /* Get a tasks */
        app.get('/api/v1/single-task/:id', verifyToken, async (req, res) => {
            try {
                const email = req.query?.email;
                const { id } = req.params
                const query = { _id: new ObjectId(id) }
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                query.email = email;
                const tasks = await taskCollection.findOne(query);
                // console.log(tasks);

                res.send(tasks)
            } catch (error) {
                console.log('Error getting tasks: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /* update status of a task */
        app.patch('/api/v1/update-tasks/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params

                const query = { _id: new ObjectId(id) }

                const todo = req.body;

                const updatedTask = {
                    $set: {
                        ...todo
                    }
                }
                // console.log(updatedTask);

                const task = await taskCollection.updateOne(query, updatedTask);


                // console.log(task);
                res.send(task)
            } catch (error) {
                console.log('Error getting tasks: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /* delete a task */
        app.delete('/api/v1/delete-tasks/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params

                const query = { _id: new ObjectId(id) }

                const task = await taskCollection.deleteOne(query);

                // console.log('Deleted task: ', task);

                res.send(task)
            } catch (error) {
                console.log('Error getting tasks: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /**
        * ================================================================
        * SEARCH APIs
        * ================================================================
        */
        app.get('/api/v1/search', verifyToken, async (req, res) => {
            try {
                const search = req.query?.search
                const email = req.query?.email;
                let query = { title: { $regex: new RegExp(search, 'i') } }
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                query.email = email;

                const task = await taskCollection.find(query, { _id: 1 }).toArray();

                // console.log('Searched task: ', task);

                res.send(task)
            } catch (error) {
                console.log('Error getting tasks: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /**
        * ================================================================
        * NOTIFICATION APIs
        * ================================================================
        */
        /* Set notifications */
        app.post('/api/v1/set-notifications', verifyToken, async (req, res) => {
            try {
                const notification = req.body
                const email = req.query?.email;
                let query = {}
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                query.email = email;

                const result = await notificationCollection.insertOne(notification);

                // console.log('Set notification: ', result);

                res.send(result)
            } catch (error) {
                console.log('Error setting notification: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /* Get all notifications */
        app.get('/api/v1/notifications', verifyToken, async (req, res) => {
            try {
                const email = req.query?.email;
                let query = {}
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                query.email = email;
                const tasks = await notificationCollection.find(query).toArray();

                // console.log('notifications: ', tasks);

                res.send(tasks)
            } catch (error) {
                console.log('Error getting notifications: ', error);
                res.status(500).send({ message: error?.message })
            }
        })

        /* Delete all notifications */
        app.delete('/api/v1/remove-notifications', verifyToken, async (req, res) => {
            try {
                const email = req.query?.email;
                let query = {}
                if (email !== req.user?.email) return res.status(403).send({ message: 'Forbidden Access' })

                query.email = email;
                const result = await notificationCollection.deleteMany(query);

                // console.log('Remove notifications: ', result);

                res.send(result)
            } catch (error) {
                console.log('Error deleting notification: ', error);
                res.status(500).send({ message: error?.message })
            }
        })
    } catch (error) {
        console.log(error);
    }
}
run().catch(console.dir);





app.get('/', (_req, res) => {
    res.send('Todo App is running');
})

app.listen(port, () => {
    console.log(`Todo server is running on ${port}`);
})