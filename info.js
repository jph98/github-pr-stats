#!/usr/bin/env node
const { Octokit } = require("@octokit/rest");
const moment = require("moment");
const _ = require('lodash');
const fs = require('fs');
const groupArray = require('group-array');
const Table = require('cli-table');
const colors = require('colors');

const NUMBER_OF_DAYS_TO_GO_BACK = 14;
const DEBUG = false;

const config = JSON.parse(fs.readFileSync('config.json'));
console.log('Config...');
console.log(config);
const octo = new Octokit({
  auth: config.apikey
});

const format_day_time = async(openedFor) => {
  return openedFor.days() + ' days ' + openedFor.hours() + 'hrs ' + openedFor.minutes() + 'mins '
};

const format_pr_short = async(req) => {
  const start = moment(req.created_at);
  const end = moment(req.updated_at);    
  const openedFor = moment.duration(end.diff(start));    
 
  return {
    'user': req.user.login,
    'title': req.title,
    'created_at': start,
    'created_at_day': start.format('DD-MM'),
    'updated_at': end,
    'opened_for': await format_day_time(openedFor),
    'opened_for_raw': openedFor.valueOf()
  }
};

const format_pr = async(req) => {
  const start = moment(req.created_at);
  const end = moment(req.updated_at);    
  const openedFor = moment.duration(end.diff(start));    
  return {
    'url': `https://github.com/insurestreetltd/canopy-backend/pull/${req.number}`,
    'user': req.user.login,
    'assignee': _.get(req, 'req.assignee.login', 'none'),
    'title': req.title,
    'number': req.number,
    'created_at': start,
    'created_at_day': start.format('DD-MM'),
    'updated_at': end,
    'opened_for': await format_day_time(openedFor),
    'opened_for_raw': openedFor.valueOf()
  }
};

const getRepos = async (org) => {
  const res = await octo.pulls.list({
      org: org,
      type: 'public'
  })
  return res.data
}

const getOpenPullRequests = async (org, repo) => {
  const res = await octo.pulls.list({
      owner: org,
      repo,
      state: 'open'
  })
  return res.data
}

const generateReport = async (daysToGoBack, pullRequests, averageOnly) => {
  
  console.log(`\nFound ${pullRequests.length} pull requests for last ${daysToGoBack} days`);  
  const prs_by_day = groupArray(pullRequests, 'created_at_day');
  for (const key in prs_by_day) {
    var table = new Table({
      head: ['Date'.white, 'Title'.white, 'Open For'.white], 
      colWidths: [10, 60, 30]
    });
    if (averageOnly) console.log(key);
    const pullRequests = prs_by_day[key];
    let sum = 0;
    let overThreshold = 0;
    let underThreshold = 0;
    prs_by_day[key].map(async(pr) => {
      sum += pr.opened_for_raw;      
      const openedFor = moment.duration(pr.opened_for_raw);      
      const timeTaken = openedFor.days() + ' days ' + openedFor.hours() + 'hrs ' + openedFor.minutes() + 'mins ';            
      openedFor.days() >= 1 ? overThreshold += 1 : underThreshold += 1;
      if (openedFor.days() >= 1) {
        table.push([key, pr.title.substring(0, 50).red, timeTaken.red]);
      } else {
        table.push([key, pr.title.substring(0, 50).green, timeTaken.green]);
      }
    });
    const openedFor = moment.duration(sum / pullRequests.length);
    const timeTaken = openedFor.days() + ' days ' + openedFor.hours() + 'hrs ' + openedFor.minutes() + 'mins ';      
    if (!averageOnly) console.log(table.toString());

    const total = overThreshold + underThreshold;
    console.log(`\n🐙 📅 Daily Stats 📅 🐙\n`);
    console.log(`Merge Requests Time Taken >= 1 day: ${(overThreshold / total * 100).toFixed(2)}%`);
    console.log(`Merge Requests Resolved in < 1 day: ${(underThreshold / total * 100).toFixed(2)}%`);    
    
    if (openedFor.days() >= 1) {
      console.log(`Average time to merge: ${timeTaken}\n`.red);
    } else {
      console.log(`Average time to merge: ${timeTaken}\n`.green);
    }
  }
}

const display_pull_request_stats = async (repo, daysToGoBack, averageOnly) => {
  
  const params = {
    owner: config.org,
    repo,
    state: 'closed'
  }

  let pullRequests = [];
  for await (const response of octo.paginate.iterator(octo.pulls.list, params)) {
    let done = false;
    for (let i = 0; i < response.data.length; i++) {
      const pr = await format_pr_short(response.data[i]);                  
      const earliestDate = moment(moment(new Date())).subtract(daysToGoBack, 'days');
      const cutOffDate = moment(pr.created_at).isBefore(earliestDate);
      if (cutOffDate === true) {                        
        done = true;
      } else {
        pullRequests.push(pr);              
      }          
    }
    if (done) {      
      break;
    }
  }  

  await generateReport(daysToGoBack, pullRequests, averageOnly);
  console.log(`Found: ${pullRequests.length} requests from: ${daysToGoBack} days ago\n`);
}

const display_open_pull_requests = async(repo) => {
  
  const requests = await getOpenPullRequests(config.org, repo)      
  
  var table = new Table({
    head: ['User'.white, 'Assignee'.white, 'Title'.white, 'Opened For'.white], 
    colWidths: [20, 60, 30]
  });
  // requests.map(async(req) => {  
  for (const req in requests) {
    const pr = await format_pr(requests[req]);
    const openedFor = moment.duration(pr.opened_for_raw);      

    if (DEBUG) console.log(pr);
    if (openedFor.days() >= 1) {
      table.push([pr.user.red, pr.title.substring(0, 50).red, pr.opened_for.red]);
    } else {
      table.push([pr.user.green, pr.title.green.substring(0, 50), pr.opened_for.green]);
    }
  }
  console.log(table.toString());
  console.log(`Number of PR's: ${requests.length}`);
}

if (process.argv.length === 3) {
  
  process.argv[2] === 'open' && display_open_pull_requests(config.repo);
  process.argv[2] === 'stats' && display_pull_request_stats(config.repo, NUMBER_OF_DAYS_TO_GO_BACK, false);
} else {
  console.log(`Usage: ${process.argv[1]} <open|stats>`)
}

