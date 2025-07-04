require('dotenv').config();
const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const app = express()
const port = 3000;

app.use(cors());
app.use(express.json());

const stripe = require('stripe')(process.env.STRIPE_SECRET);


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const parcelCollection = client.db('profastDB').collection('parcelCollection');
const paymentsCollection = client.db('profastDB').collection('payments');



async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        app.post('/addParcel', async (req, res) => {
            try {
                const parcelData = req.body;
                const result = await parcelCollection.insertOne(parcelData);
                res.status(201).send({ message: 'Parcel added to database.', result });
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.get('/parcels', async (req, res) => {
            try {
                const { email } = req.query;
                let filter = {};
                if (email) {
                    filter = { created_by: email };
                }
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




        app.get('/payments', async (req, res) => {
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
