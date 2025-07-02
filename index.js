require('dotenv').config();
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const app = express()
const port = 3000;

app.use(cors());
app.use(express.json());


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const parcelCollection = client.db('profastDB').collection('parcelCollection');


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
