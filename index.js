require('dotenv').config();
const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const cors = require('cors');
const app = express()
const port = 3000;

app.use(cors());
app.use(express.json());

const stripe = require('stripe')(process.env.STRIPE_SECRET);


const serviceAccount = require("./profast-firebase-secret.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const db = client.db('profastDB');

const parcelCollection = db.collection('parcelCollection');
const paymentsCollection = db.collection('payments');
const usersCollection = db.collection('users');
const ridersCollection = db.collection('riders');



async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();


        // middlewares

        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                res.status(500).send({ message: 'internal server error' });
            }

        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const result = await usersCollection.findOne({ email });
            if (!result || result.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        };

        const verifyRider = async (req, res, next) => {
            const email = req.decoded.email;
            const result = await usersCollection.findOne({ email });
            if (!result || result.role !== 'rider') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }




        // parcel apis

        app.post('/addParcel', async (req, res) => {
            try {
                const parcelData = req.body;
                const result = await parcelCollection.insertOne(parcelData);
                res.status(201).send({ message: 'Parcel added to database.', result });
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;
                let filter = {};
                if (email) {
                    filter = { created_by: email };
                }
                if (payment_status) {
                    filter.payment_status = payment_status
                }
                if (delivery_status) {
                    filter.delivery_status = delivery_status
                }
                console.log(filter);
                const parcels = await parcelCollection.find(filter).toArray();
                res.status(200).send(parcels);
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        })

        app.get('/parcel/:id', async (req, res) => {

            try {
                const { id } = req.params;
                if (!ObjectId.isValid(id)) {
                    res.status(400).send({ message: 'Invalid parcel id.' })
                }

                const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

                if (!parcel) {
                    res.status(400).send({ message: 'parcel not found' })
                }

                res.status(200).send(parcel);


            } catch (error) {
                res.status(500).send({ message: 'Internal server error' })
            }
        });

        app.patch('/parcels/:id/assign', async (req, res) => {
            const { id } = req.params;
            const { riderId, riderName, riderEmail } = req.body;
            if (!id) {
                res.status(400).send({ message: 'parcel id not found' });
            };
            try {
                const updateParcel = {
                    $set: {
                        delivery_status: 'rider_assigned',
                        assigned_rider_id: riderId,
                        assigned_rider_name: riderName,
                        assigned_rider_email: riderEmail
                    }
                }
                await parcelCollection.updateOne({ _id: new ObjectId(id) }, updateParcel);

                const updateRider = {
                    $set: {
                        work_status: 'In delivery'
                    }
                }
                await ridersCollection.updateOne({ _id: new ObjectId(riderId) }, updateRider);
                if (!updateParcel || !updateRider) {
                    return res.status(400).send({ message: 'failed to update the parcel' })
                }
                res.status(202).send({ message: 'parcel update successful', success: true });

            }
            catch (error) {
                res.status(500).send({ message: 'error updating assign rider', error });
            }
        })

        app.patch('/parcels/:id/status', async (req, res) => {
            const { id } = req.params;
            if (!id) {
                return res.status(400).send({ message: 'parcel id not found' });
            }

            const { status } = req.body;
            if (!status) {
                return res.status(400).send({ message: 'no update status found' })
            }
            const updatedStatus = {
                delivery_status: status
            }
            if (status === 'in_transit') {
                updatedStatus.picked_at = new Date().toISOString()
            } else if (status === 'delivered') {
                updatedStatus.delivered_at = new Date().toISOString();
            }

            try {
                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: updatedStatus
                    }

                );
                res.status(202).send(result);
            } catch (error) {
                res.status(500).send({ message: 'error patching parcel status' })
            }


        })




        // rider apis

        app.post('/riders',verifyFBToken,verifyAdmin, async (req, res) => {
            try {
                const riderInfo = req.body;
                // console.log(riderInfo);
                const result = await ridersCollection.insertOne(riderInfo);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: 'internal server error' });
            }
        });

        app.get('/riders/parcels',verifyFBToken,verifyRider, async (req, res) => {
            const { email } = req.query;
            if (!email) {
                return res.status(400).send({ message: 'rider email is required' });
            }

            const query = {
                assigned_rider_email: email,
                delivery_status: { $in: ['rider_assigned', 'in_transit'] }
            };
            const options = {
                sort: { creation_date: -1 }
            }

            try {
                const result = await parcelCollection.find(query, options).toArray();
                res.status(200).send(result);
            }
            catch (error) {
                res.status(500).send({ message: 'error fetching assigned parcels' });
            }

        })

        app.get('/riders/available',verifyFBToken,verifyAdmin, async (req, res) => {
            console.log('entered available riders api');
            try {
                const { district } = req.query
                // console.log('request query',req.query);
                if (!district) {
                    return res.status(400).send({ message: "empty district name" });
                }
                const riders = await ridersCollection.find({ district }).toArray();
                if (!riders) {
                    return res.status(404).send({ message: "no riders found that area" });
                }
                res.status(200).send(riders);
            }
            catch (error) {
                res.status(500).send({ message: "error fetching available riders data on the server" });
            }
        })

        app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const riders = await ridersCollection.find({ status: "pending" }).toArray();
                res.status(200).send(riders);
            } catch (error) {
                res.status(500).send({ message: 'failed to find pending riders applications!', error });
            }
        });

        app.get('/riders/active', verifyFBToken, verifyAdmin, async (req, res) => {
            const activeRiders = await ridersCollection.find({ status: "active" }).toArray();
            res.send(activeRiders);
        });

        app.get('/rider/completed-parcels',verifyFBToken,verifyRider, async (req, res) => {
            const { email } = req.query;
            if (!email) {
                return res.status(400).send({ message: "rider email didn't found!" });
            }
            const filter = {
                assigned_rider_email: email,
                delivery_status: {
                    $in: ['delivered', 'service_center_delivered']
                }

            };

            const options = {
                sort: { creation_date: -1 }
            }
            try {
                const result = await parcelCollection.findOne(filter, options);
                res.status(200).send(result)
            }
            catch (error) {
                res.status(500).send({ message: "error getting completed parcels data" });
            }

        })

        app.patch('/riders/:id/status',verifyFBToken,verifyAdmin, async (req, res) => {
            console.log('entered patch');
            try {
                const { id } = req.params;
                const query = { _id: new ObjectId(id) };
                const { status, email } = req.body;

                if (status === 'active') {
                    const userQuery = { email }
                    const updatedUserDoc = {
                        $set: {
                            role: 'rider'
                        }
                    }
                    const updatedResult = await usersCollection.updateOne(userQuery, updatedUserDoc);
                    if (updatedResult?.modifiedCount) {
                        res.status(202).send({ message: 'updated user role', updatedResult })
                    }
                }

                const updatedDoc = {
                    $set: {
                        status
                    }
                }
                // console.log(query, status, updatedDoc);
                const result = await ridersCollection.updateOne(query, updatedDoc)
                res.send(result)
            }
            catch (error) {
                res.status(500).send({ message: 'internal server error', error });
            }
        })



        // user apis

        app.post('/users', async (req, res) => {
            try {
                const userInfo = req.body;

                const filter = { email: userInfo.email };

                const existingUser = await usersCollection.findOne(filter);
                if (existingUser) return

                const result = await usersCollection.insertOne(userInfo);
                res.status(201).send(result)
            }
            catch (error) {
                res.status(500).send({ message: 'internal server error' });
            }
        });

        app.get('/users/search', verifyFBToken, verifyAdmin, async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }

            const regex = new RegExp(emailQuery, "i"); // case insensitive

            try {
                const users = await usersCollection.find(
                    { email: { $regex: regex } }
                ).limit(10).toArray();
                res.send(users);
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }

        });


        app.get('/user/:email/role', verifyFBToken, async (req, res) => {
            try {
                const { email } = req.params;
                if (!email) {
                    return res.status(400).send({ message: "email not found!" })
                }
                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(404).send({ message: "No user found with this email!" })
                }
                res.status(200).send({ role: user.role || 'user' });
            }
            catch (error) {
                res.status(500).send({ message: "internal server error" });
            }
        })


        app.patch('/user/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const { role } = req.body;
                // console.log(id, role);

                if (!["admin", "user"].includes(role)) {
                    return res.status(400).send({ message: "Invalid role" });
                }

                const updatedResult = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            role
                        }
                    }
                );
                res.status(202).send(updatedResult);
            }
            catch (error) {
                res.status(500).send({ message: 'internal server error' })
            }
        })





        // payment apis

        app.get('/payments', verifyFBToken, async (req, res) => {
            try {
                const userEmail = req.query.email;
                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } };
                const payments = await paymentsCollection.find(query, options).toArray();
                res.status(200).send(payments);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get payments' });
            }
        })


        // POST: Record payment and update parcel status
        app.post('/payments', async (req, res) => {
            // const body = req.body;
            // console.log(body);
            try {
                const { parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId, } = req.body;
                console.log(req.body);

                // 1. Update parcel's payment_status
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                );
                console.log(updateResult);
                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: 'Parcel not found or already paid' });
                }

                // 2. Insert payment record
                const paymentDoc = {
                    parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date(),
                };

                console.log(paymentDoc);

                const paymentResult = await paymentsCollection.insertOne(paymentDoc);
                res.status(201).send({
                    message: 'Payment recorded and parcel marked as paid',
                    insertedId: paymentResult.insertedId,
                });

            } catch (error) {
                console.error('Payment processing failed:', error);
                res.status(500).send({ message: 'Failed to record payment' });
            }
        });


        app.post('/create-payment-intent', async (req, res) => {
            const { amount, paymentMethodId } = req.body;

            console.log('Received:', { amount, paymentMethodId });

            // ✅ Validation
            if (!amount || !paymentMethodId) {
                return res.status(400).json({ message: 'Missing amount or paymentMethodId' });
            }

            try {
                // ❌ REMOVE: confirm: true — let client confirm!
                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: 'usd',
                    payment_method: paymentMethodId,
                    payment_method_types: ['card']
                });

                res.status(200).json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                console.error('Stripe Error:', error.message);
                res.status(400).json({ message: error.message });
            }
        });






        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
