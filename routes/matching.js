var path = require("path");
var express = require('express');
var router = express.Router();
var _document = require('langchain/document');
var fs = require('fs').promises;

var Bull = require('bull');
var pinecone = require('@pinecone-database/pinecone');
var openAI = require('langchain/embeddings/openai');
const { Client } = require('@elastic/elasticsearch');
const { PineconeStore } = require('langchain/vectorstores/pinecone');

const index = 'candidates';
const timeSet = "23:59:59"; 
const setDay = 86400;
const PINECONE_API_KEYS = process.env.pineconeAPI;
const PINECONE_ENV = process.env.pineconeHost;
const OPEN_API_KEY = process.env.openAI;


const embeddings = new openAI.OpenAIEmbeddings({
  openAIApiKey: OPEN_API_KEY, 
});

const pineconeClient = new pinecone.PineconeClient();

const elasClient = new Client({
  node:"https://63ds3uw4zg:eypaplrdkw@jobs-2424578584.us-east-1.bonsaisearch.net:443"
});

//Retrive index of pinecone
const getPineConeIndex = async() => {
  try {
    await pineconeClient.init({
     environment: PINECONE_ENV,
     apiKey: PINECONE_API_KEYS,});
  } catch (err) {
    console.log('Fail to init pinecone clinet');
  }
  let t = pineconeClient.Index(index);
  return t;
};


/*
Upsert Entries into Pinecone with BATCH_SIZE = 1000
*/
const BATCH = 1000;

const updateByBatch = async(pineconeIndex,res) => {
  let count = 0;
  try {

    const que = []
    let result = res;
    que.push(result);
    let lastEntry;

    while (que.length) {
      
      const body = que.shift().body;
      let docs = [];
      if ((body.hits.total.value == 0) || !(body.hits.hits.length)){ 
        break;
      }
      body.hits.hits.forEach(function (hit) {
        var _doc =  new _document.Document({
          metadata: { timestamp: hit._source["timestamp"], id : hit._id },
          pageContent: getCandidateInfo(hit._source),
        });
        docs.push(_doc);
        count ++;
      });
      
      await PineconeStore.fromDocuments(docs, embeddings, {
            pineconeIndex,
          });
      
      if (body.hits.total.value === count) {
        break;
      }

      result = await elasClient.scroll({
        scrollId: body._scroll_id,
        scroll: '1m',
        });
      que.push(result);
    }
  } catch(error) {
    console.log(error);
  }
};

//Helper function for format timestamp as YYYYMMDD HH:MM:SS
const getFormatDate = ((date) => {
  return date.getFullYear() + '-' + ("00" + (date.getMonth()+1)).slice(-2) + '-' + date.getDate() + ' ' + timeSet;

});

const syncPinecone = (async(isInit) => {
  let pineconeIndex = await getPineConeIndex();
  try {
    let response;
    if (isInit) { //case init pinecone
      response = await elasClient.search({
        index:'candidates',
        scroll: '1m',
        body: {
        size:BATCH,
        query:{
          "match_all": {
          }
        },   
      }});
      

    } else { // sync day by day
      let curDate = getFormatDate(new Date());
      let epochCurDate = new Date(curDate).getTime();
      let epochPrevDate = epochCurDate - setDay*2;
      let prevDate = getFormatDate(new Date(epochPrevDate));

      response = await elasClient.search({
        index:'candidates',
        scroll: '1m',
        body: {
        size:BATCH,
        query:{
          "bool": {
            "filter": [
              {
                "range": {
                  "timestamp": {
                    "gte": prevDate,
                    "lte": curDate,
                  }
                }
              }
            ]
          }
        },   
      }});
    }      
    return response;

  } catch(err) {
    console.log('Failed to sync Pinecone');
  }
  
});

const syncQueue = new Bull('sync-queue');

const job = async () => {
  //cron only rune only at 23:59:59 everyday
  await syncQueue.add({},{ repeat: { cron: '59 59 23 * * *' } });
  
};


//Queue Implementation with cron 
syncQueue.process(async (job) => {
  let pineconeIndex = await getPineConeIndex();
  let stats = await pineconeIndex.describeIndexStats({
    describeIndexStatsRequest: {
      filter: {},
    },
  });
  let isInit = stats.totalVectorCount == 0;
  
  let response = await syncPinecone(isInit);
  if ((response.body.hits.v > 0) || (response.body.hits.hits.length)){ 
    await updateByBatch(pineconeIndex,response); 
  }
});

job();

/*
//Remove any on-going cron jobs
syncQueue.clean(0, 'delayed');
syncQueue.clean(0, 'wait');
syncQueue.clean(0, 'active');
syncQueue.clean(0, 'completed');
syncQueue.clean(0, 'failed');
*/



router.get('/', async(req, res, next) => {
  res.send('update matching candidate and jobs');
});

//Helper function to get info of candidate as text
const getCandidateInfo = ((candidate) => {
    let text = ''
    text += 'My name is ' + candidate['firstName'] + ' ' + candidate['lastName'] + '.'
    if (candidate['experience']){
      text += 'I have about ' + candidate['experience'] + ' years of experiences' + '.'
    }
    if (candidate['role']){
      text += 'I am working as ' + candidate['role'] + '.'
    }
    if (candidate['jobTitle']) {
      text += 'My previous job was as ' + candidate['jobTitle'] + '.'
    }
    if (candidate['currentLocation'] || candidate['country']) {
      text += 'Location is in ' + candidate['currentLocation'] + '.'
    }
    if (candidate['skills']){
      text += 'My skillset includes ' + candidate['skills']
    }
    return text
});

//Helper function to get job info as text
const getJobInfo = ((job) => {
    let text = ''
    text += 'Position is ' + job['job_title'] + '.'
    if (job['job_location']){
      text += 'Location is in ' + job['job_location'] + '.'
    }
    if (job['job_requirements']){
      text += 'Requirements of the jobs: ' + job['job_requirements'] + '.'
    }
    if (job['job_salary']) {
      text += 'Salary is (in range) ' + job['job_salary'] + '.'
    }
    if (job['job_total_comp']){
      text += 'Total compensation package: ' + job['job_total_comp']
    }
    return text
});


router.get('/find-candidate/:jobID', async function(req, res, next) {
  let filePath = path.join(process.cwd(), "data_jobs.json");
  let jobID = req.params.jobID;
  await fs.readFile(filePath)
    .then((data) => {
      jobJson = JSON.parse(data);
      jobData = getJobInfo(jobJson[jobID]);
      console.log(jobData);
      (async() => {
        let pineconeIndex = await getPineConeIndex();
        let v = await embeddings.embedQuery(jobData);
        
        const queryRequest = {
          vector: v,
          topK: 10,
          includeValues: false,
          includeMetadata: true,
        };
        
        let result = await pineconeIndex.query({queryRequest});
        //console.log(result.matches);
        candidates = []
        for (var i = 0; i < result.matches.length; i++) {
          candidates.push({'info':result.matches[i].metadata.text });
        }
        res.json({'list_candidates':candidates});
      })();
      
    })
    .catch((error) => {
      res.json({'status':"failed to proceed at this time. Please try again."})
    });
  
});

module.exports = router;
