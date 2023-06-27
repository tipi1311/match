var express = require("express");
var router = express.Router();
var request = require("request");

let apiHost = process.env.apiHost;
let linkedinClientId = process.env.linkedinClientId;
let linkedInClientSecret = process.env.linkedInClientSecret;
let isActiveFlag = process.env.isActiveFlag;

let authorizationLink =
  "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=" +
  linkedinClientId +
  "&redirect_uri=" +
  apiHost +
  "/onboardUserOnLinkedIn/addUser&scope=r_organization_social%20r_1st_connections_size%20r_ads_reporting%20r_emailaddress%20rw_organization_admin%20r_liteprofile%20r_basicprofile%20r_ads%20rw_ads%20w_member_social%20w_organization_social";
let redirectUrl = apiHost + "/onboardUserOnLinkedIn/addUser";
let createUserAPI = apiHost + "/socialAccounts/createUser";
let allUserAPI = apiHost + "/socialAccounts/AllUsers";

/* Register User. */
router.get("/addUser", async function (req, res, next) {
  let couponCode = await getRandomCouponCode(8);
  let getUserData = await validateCouponCode(couponCode);
  while (JSON.parse(getUserData.body).length > 0) {
    couponCode = await getRandomCouponCode(8);
    getUserData = await validateCouponCode(couponCode);
  }

  let action = "/onboardUserOnLinkedIn/addUser";
  if (process.env.env == "Prod") {
    action = "/drip" + action;
  }

  res.render("addUser", {
    title: "Onboard User On LinkedIn AutoPost",
    couponCode: couponCode,
    drip: action,
  });
});

/* Register User. */
router.get("/getLinkedinCode", function (req, res, next) {
  res.render("linkedInCode", {
    title: "Onboard User On LinkedIn AutoPost",
    link: authorizationLink,
  });
});

router.post("/addUser", async function (req, res) {
  let linkedinCode = req.body.LinkedInCode.replace("?code=", "");
  let newCouponCode = req.body.CouponCode;

  let linkedinAccessToken = await getLinkedinAccessToken(linkedinCode);

  let linkedinUserId;
  let linkedinUserEmail;
  if (linkedinAccessToken.statusCode == 200) {
    linkedinUserId = await getUserId(linkedinAccessToken.accessToken);
    linkedinUserEmail = await getUserEmail(linkedinAccessToken.accessToken);

    let addUserInDataBase;
    if (linkedinUserId.statusCode == 200) {
      addUserInDataBase = await addUserInDB(
        linkedinUserId.fullName,
        linkedinUserEmail.email,
        linkedinAccessToken.accessToken,
        linkedinUserId.userId,
        linkedinAccessToken.refresh_token,
        linkedinAccessToken.expires_in,
        linkedinAccessToken.refresh_token_expires_in,
        newCouponCode
      );

      if (addUserInDataBase.statusCode == 200) {
        res.render("successPage", {
          title: "Onboard User On LinkedIn AutoPost",
        });
      } else {
        console.log("Error add user to db");
        res.render("errorPage", {
          title: "Onboard User On LinkedIn AutoPost",
          message: "Error while adding user information in DB",
          link: authorizationLink,
        });
      }
    } else {
      res.render("errorPage", {
        title: "Onboard User On LinkedIn AutoPost",
        message: "Error while getting LinkedIn User Id",
        link: authorizationLink,
      });
    }
  } else {
    console.log("Error access token");
    res.render("errorPage", {
      title: "Onboard User On LinkedIn AutoPost",
      message: "Error while generating access token",
      link: authorizationLink,
    });
  }
});

async function getLinkedinAccessToken(linkedinCode) {
  let linkedinAccessToken;
  let linkedinRefreshToken;
  let linkedinAccessTokenExpiry;
  let linkedinRefreshTokenExpiry;
  let linkedinAccessTokenStatusCode;
  var options = {
    method: "POST",
    url: "https://www.linkedin.com/oauth/v2/accessToken",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    form: {
      grant_type: "authorization_code",
      code: linkedinCode,
      redirect_uri: redirectUrl,
      client_id: linkedinClientId,
      client_secret: linkedInClientSecret,
    },
  };

  request(options, function (error, response, body) {
    linkedinAccessTokenStatusCode = response.statusCode;
    if (error) {
      console.log("getLinkedinAccessToken error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (linkedinAccessTokenStatusCode == 200) {
        linkedinAccessToken = JSON.parse(body).access_token;
        linkedinRefreshToken = JSON.parse(body).refresh_token;
        linkedinAccessTokenExpiry = JSON.parse(body).expires_in;
        linkedinRefreshTokenExpiry = JSON.parse(body).refresh_token_expires_in;
      }
      console.log(
        "getLinkedinAccessToken body access_token:- " +
          JSON.parse(body).access_token
      );
      console.log(
        "getLinkedinAccessToken body error:- " + JSON.parse(body).error
      );
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: linkedinAccessTokenStatusCode,
        accessToken: linkedinAccessToken,
        refresh_token: linkedinRefreshToken,
        expires_in: linkedinAccessTokenExpiry,
        refresh_token_expires_in: linkedinRefreshTokenExpiry,
      });
    }, 5000);
  });
}

async function getUserId(linkedinAccessToken) {
  let linkedinUserId;
  let linkedinUserIdStatusCode;
  let localizedFirstName;
  let localizedLastName;
  var options = {
    method: "GET",
    url: "https://api.linkedin.com/v2/me",
    headers: {
      authorization: "Bearer " + linkedinAccessToken,
    },
  };

  request(options, function (error, response, body) {
    linkedinUserIdStatusCode = response.statusCode;
    if (error) {
      console.log("getUserId error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (linkedinUserIdStatusCode == 200) {
        linkedinUserId = JSON.parse(body).id;
        localizedFirstName = JSON.parse(body).localizedFirstName;
        localizedLastName = JSON.parse(body).localizedLastName;
      }
      //console.log("getUserId body id:- " + linkedinUserId);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: linkedinUserIdStatusCode,
        userId: linkedinUserId,
        fullName: localizedFirstName + " " + localizedLastName,
      });
    }, 5000);
  });
}

async function testPostOnLinkedin(linkedinAccessToken, linkedinUserId) {
  let linkedinPostId;
  let linkedinPostStatusCode;
  var options = {
    method: "POST",
    url: "https://api.linkedin.com/v2/ugcPosts",
    headers: {
      authorization: "Bearer " + linkedinAccessToken,
      "content-type": "application/json",
    },
    body: {
      author: "urn:li:person:" + linkedinUserId,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text:
              "Test Message " + (Math.random() + 1).toString(36).substring(7),
          },
          shareMediaCategory: "ARTICLE",
          media: [
            {
              status: "READY",
              originalUrl: "https://interviewhelp.io/",
            },
          ],
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    },
    json: true,
  };

  request(options, function (error, response, body) {
    linkedinPostStatusCode = response.statusCode;
    if (error) {
      console.log("testPostOnLinkedin error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (response.statusCode == 201) {
        linkedinPostId = body.id;
      }
      console.log("testPostOnLinkedin body id:- " + linkedinPostId);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: linkedinPostStatusCode,
        postId: linkedinPostId,
      });
    }, 5000);
  });
}

async function addUserInDB(
  fullName,
  userEmail,
  linkedinAccessToken,
  linkedinUserId,
  linkedinRefreshToken,
  linkedinAccessTokenExpiry,
  linkedinRefreshTokenExpiry,
  newCouponCode
) {
  let addUser;
  let addUserStatusCode;
  var options = {
    method: "POST",
    url: createUserAPI,
    headers: {
      "content-type": "application/json",
    },
    body: {
      name: fullName,
      accessToken: linkedinAccessToken,
      userId: linkedinUserId,
      organization: "InterviewHelp.io",
      maxNumberOfPostsPerDay: 5,
      isActive: isActiveFlag,
      platform: "LinkedIn",
      email: userEmail,
      refreshTokenExpiryTime: linkedinRefreshTokenExpiry,
      accessTokenExpiryTime: linkedinAccessTokenExpiry,
      refreshToken: linkedinRefreshToken,
      couponCode: newCouponCode,
    },
    json: true,
  };

  request(options, function (error, response, body) {
    addUserStatusCode = response.statusCode;
    if (error) {
      console.log("Add user to DB error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (addUserStatusCode == 200) {
        addUser = body;
      }
      console.log("Add user to DB body id:- " + addUser);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        userDetails: addUser,
        statusCode: addUserStatusCode,
      });
    }, 5000);
  });
}

async function deleteLinkedinPost(linkedinPostId, linkedinAccessToken) {
  let deletePostStatusCode;
  let deletePostBody;
  var options = {
    method: "DELETE",
    url: "https://api.linkedin.com/v2/ugcPosts/" + linkedinPostId,
    headers: {
      authorization: "Bearer " + linkedinAccessToken,
    },
  };

  request(options, function (error, response, body) {
    deletePostStatusCode = response.statusCode;
    if (error) {
      console.log("Delete linkedin post error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (deletePostStatusCode == 204) {
        deletePostBody = body;
      }
      console.log("Delete linkedin post body id:- " + deletePostBody);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: deletePostStatusCode,
      });
    }, 5000);
  });
}

async function getUserbasedOnEmail(userEmail) {
  let getUserDataStatusCode;
  let getUserDataBody;
  var options = {
    method: "GET",
    url: allUserAPI,
    qs: { email: userEmail, platform: "LinkedIn" },
    headers: {
      apitoken: "61c189c8f2ab3dd77051e3fb",
    },
  };

  request(options, function (error, response, body) {
    getUserDataStatusCode = response.statusCode;
    if (error) {
      console.log("Get User based on Email error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (getUserDataStatusCode == 200) {
        getUserDataBody = body;
      }
      console.log("Get User based on Email body:- " + getUserDataBody);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: getUserDataStatusCode,
        body: getUserDataBody,
      });
    }, 5000);
  });
}

async function getRandomCouponCode(length) {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

async function validateCouponCode(newCouponCode) {
  let getUserDataStatusCode;
  let getUserDataBody;
  var options = {
    method: "GET",
    url: allUserAPI,
    qs: { couponCode: newCouponCode, platform: "LinkedIn" },
    headers: {
      apitoken: "61c189c8f2ab3dd77051e3fb",
    },
  };

  request(options, function (error, response, body) {
    getUserDataStatusCode = response.statusCode;
    if (error) {
      console.log(
        "Get User based on Coupon code error:" + JSON.stringify(error)
      );
      errorToThrow = error;
    } else {
      if (getUserDataStatusCode == 200) {
        getUserDataBody = body;
      }
      console.log("Get User based on Coupon code body:- " + getUserDataBody);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: getUserDataStatusCode,
        body: getUserDataBody,
      });
    }, 5000);
  });
}

async function getUserEmail(linkedinAccessToken) {
  let getUserEmail;
  let getUserEmailStatusCode;
  var options = {
    method: "GET",
    url: "https://api.linkedin.com/v2/clientAwareMemberHandles",
    qs: { q: "members", projection: "(elements*(primary,type,handle~))" },
    headers: {
      authorization: "Bearer " + linkedinAccessToken,
    },
  };

  request(options, function (error, response, body) {
    getUserEmailStatusCode = response.statusCode;
    if (error) {
      console.log("Get User Email error:" + JSON.stringify(error));
      errorToThrow = error;
    } else {
      if (getUserEmailStatusCode == 200) {
        getUserEmail = JSON.parse(body).elements[0]["handle~"].emailAddress;
      }
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        statusCode: getUserEmailStatusCode,
        email: getUserEmail,
      });
    }, 5000);
  });
}

module.exports = router;
