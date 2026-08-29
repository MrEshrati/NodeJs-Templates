const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userScehma = new Schema({

    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },
    EmailVerified: {
        type: Boolean,
        default: false,
    }
})

module.exports = mongoose.model("User",userScehma);