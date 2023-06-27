const { text } = require("express");
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  accessToken: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  organization: {
    type: String,
    required: true,
    enum: ["Google", "Test"]
  },
  email: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    required: true,
    enum: ["Facebook", "LinkedIn", "MeetUp"]
  },
  isActive: {
    type: Boolean,
    required: true
  },
  maxNumberOfPostsPerDay: {
    type: Number,
    required: true,
    counter: Number
  },
  couponCode: {
    type: String,
    required: true,
    unique: true
  },
  refreshToken: {
    type: String,
    required: true
  },
  accessTokenExpiryTime: {
    type: Date,
    required: true
  },
  refreshTokenExpiryTime: {
    type: Date,
    required: true
  }
});

UserSchema.index({ email: 1, platform: 1 }, { unique: true });
UserSchema.index({ couponCode: "text" }, { unique: true });

const User = mongoose.model(process.env.collection, UserSchema);

module.exports = User;
