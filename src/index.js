"use strict"
const fs = require('fs').promises;
const assert = require('assert');
const parse = require('node-html-parser').parse;
const {getGMail} = require('uuseCommons');
const {
  formatDate, 
  argv, 
  month,  
  doNotUpdate,
  repeatersCMS, 
  happeningsCMS,
  newsLetterCMS } = require('uuseCommons');
const {extractFutureDate} = require('uuseCommons')
const {findStartingContent} = require('uuseCommons');
const {getArticlesFromHTML,getAllArticles} = require('uuseCommons')
const {cleanTitle, normalizeTitle} = require('uuseCommons')
const {updateMenu,bulkInsert,bulkUpdate,bulkDelete,fetchRecords, getEvents, getRepeaters} = require('uuseCommons');
const {append1, append3, divider} = require('uuseCommons')
const {richContentToText,
  getGeneratedDescriptionFromArticle,
  getLongDescriptionFromArticle,
  getTextFromArticle,
  newEvent} = require('uuseCommons');
const timestamp = new Date().toISOString();    // used in Rich Content annotations

const updatedEvents = [];
const updatedRepeaters = [];
const newEvents = [];

if (argv.help){
  console.log(argv);
  return;
}

const menuKey       = (doNotUpdate?"devNewsletter":"Newsletter");
console.log((doNotUpdate?"NOT UPDATING":"UPDATES ARE ENABLED"))//,doNotUpdate,argv.update)
console.log("Target CMS is",newsLetterCMS);

//
// Start Here
//

const {date,capture} = argv;
const filters = {subject: "Newsletter"};

getGMail(filters ,date, capture, (html)=>{
  bulkDelete(newsLetterCMS)
  const root = parse(html);
  const path = findStartingContent(root);
  const articles = getArticlesFromHTML(path);
  const services = getServices(articles);
  const allArticles = getAllArticles(articles);
  const metaNewsletter = getMetaNewsletter(articles); //create titles, etc. from articles, but not really newsletter
  getRepeaters()
    .then(repeats => {
      getEvents()
      .then(events => {
      // Create a map for faster lookups
        const newsletterMap = new Map(metaNewsletter
          .filter(mnl => mnl.data.title)  // Ensure only valid titles are mapped
          .map(mnl => [normalizeTitle(mnl.data.title), mnl])
          );

        let dateTest = true;
        console.log("Checking Event Dates")
        events.forEach(ev=>{if(ev.data && (!ev.data.date)){console.log(ev.data.date); dateTest= false}})
        assert(dateTest,"Some of the dates in the event CMS are missing");
        dateTest = true;
        events.forEach(ev=>{if(ev.data && (ev.data.date.length > 10)){console.log(ev.data.date); dateTest= false}})
        assert(dateTest,"Some of the dates in the event CMS have the wrong format");

        const serviceDateMap = new Map(events
          .filter(ev => ev.data.date && ev.data.isService === true)// Filter events with dates and isService === true
          .map(ev => [ev.data.date, ev])
          );

        const eventTitleMap = new Map();
        // Populate the map
        events
          .filter(ev => ev.data.title && ev.data.date) // Filter events with titles and dates
          .forEach(ev => {
            const normalizedTitle = normalizeTitle(ev.data.title);
            if (!eventTitleMap.has(normalizedTitle)) {
              eventTitleMap.set(normalizedTitle, []); // Initialize an array if the title is new
            }
            eventTitleMap.get(normalizedTitle).push(ev); // Add the event to the array
          });

          //
          // update repeater from newsletter, also any events tied to the repeater
          //
        repeats.forEach(repeater => {
          const eTitle = normalizeTitle(repeater.data.title);
          if (!eTitle) return;

          const newsLetterItem = newsletterMap.get(eTitle);
          if (newsLetterItem) {
            newsLetterItem.alreadyUpdated = true;
            const { richcontent, longdescription } = newsLetterItem.data;
            Object.assign(repeater.data, { richcontent, longdescription });
            repeater.why = "MNL matched title";
            updatedRepeaters.push(repeater);

            // console.log(pretty(repeater.data._id));
            // now if the updated repeater has events, let's update those
            events
             .filter(ev => {
                const repeatedEventID = ev.data.repeatedEventID || ''; // Default to an empty string if undefined
                const [firstPart] = repeatedEventID.split('_');
                if (doNotUpdate)
                  return firstPart === repeater.data.oldID;
                else
                  return firstPart === repeater.data._id;
              })
              .forEach(ev => {
                const updatedEvent = { ...ev }; // Create a shallow copy of the event
                updatedEvent.data = { ...ev.data, 
                  longdescription: repeater.data.longdescription,
                  generatedDescription: repeater.data.longdescription,
                  richcontent: repeater.data.richcontent }; // Update the longdescription
                  updatedEvent.why = "From Updated Repeater "+repeater.data.title;
                  updatedEvents.push(updatedEvent); // Add to the new list
              });
            } 
        });


        //
        // Let's look at things with dates in the title
        //
          metaNewsletter.forEach(mnl => {
          if (mnl.alreadyUpdated) {
            console.log("MNL Already Processed",mnl.data.title);
          return;}

          const eTitle = normalizeTitle(mnl.data.title);
          if (!eTitle) return;
          if (mnl.data.foundDate == null) return;
          
          const eventR = eventTitleMap.get(eTitle);
          if (eventR && eventR.length > 1){
            //special handling required
            console.log("Event has multiple dates");
            process.exit(0);
          } else {
          if (eventR) { // but don't move a date to an earlier date
            const event = eventR[0]; 
     
        //
        // Any Newsletter article that has a date, could be update, or new
        // This can't work because there could be multiple events on a date
        // but we could match title?
        //
//         metaNewsletter.forEach(mnl => {
//           if (mnl.alreadyUpdated) {
// //            console.log("MNL Already Processed",mnl.data.title);
//             return;}
//           const eTitle = normalizeTitle(mnl.data.title);
//           if (!eTitle) return;
//           if (mnl.data.foundDate == null) return;
          
//           const event = eventTitleMap.get(eTitle);
          
//          if (event) { // but don't move a date to an earlier date
            let mnlDate = new Date(mnl.data.foundDate);
            let evDate = new Date(event.data.date);
            
            let today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if ((mnlDate>evDate) && (mnlDate >= today)){
   //           console.log("Update Event Date",mnl.data.foundDate,event.data.title,event.data.date,mnl.data.title);
              event.data.date = mnl.data.foundDate;
              event.why = "Date change from newsletter"
              updatedEvents.push(event);            
            }
            else {
              console.log("No Event Date change",mnl.data.foundDate,event.data.title,event.data.date,mnl.data.title);
            }
          }
          else{ 
            console.log("New Event",mnl.data.title,"'"+mnl.data.foundDate+"'");
            newEvents.push(newEvent(mnl));
          }
        }
        });

      // Go through services and make sure they are not already existing or updated getEvents
        services.forEach(service =>{

          // console.log("hurt?",service.data.date);
          // console.log("OUCH!",serviceDateMap.get(service.data.date));
            //stop();

          let ev = serviceDateMap.get(service.data.date);
          if (ev){
            console.log("Found Service",service.data.date,service.data.title);
            // stop();
            service.why = "Updated Service"+service.data.date;
            ['longdescription', 'generatedDescription', 'richcontent', 'title'].forEach(
              key => ev.data[key] = service.data[key]
            );         
            ev.why = "Sunday Service Update"  
            updatedEvents.push(ev);
          } else {
            service.why = "New Service"+service.data.date;
            service.data.isService = true;
            newEvents.push(service)
          }  
        })

        updatedRepeaters.forEach(rUpdate =>{console.log("Update Repeater",rUpdate.data.title,"\t||Why?",rUpdate.why)})
        updatedEvents.forEach(eUpdate =>{console.log(   "update Event  -",eUpdate.data.title,"\t||Why?",eUpdate.why)})
        newEvents.forEach(newEvent=>{console.log(       "New Event - - -",newEvent.data.title,"\t||Why?",newEvent.why)});

        //  bulkDelete(newsLetterCMS) // probably some timing things here?
        // .then({
        //   bulkUpdate(repeatersCMS,updatedRepeaters);
        //   bulkUpdate(happeningsCMS,updatedEvents);
        //   bulkInsert(happeningsCMS,newEvents);
        //   updateMenu(menuKey,month+" Newsletter");
        //   metaNewsletter.push(getFullNewsletter(allArticles));
        //   newsLetterToCMS(metaNewsletter);
        // })  

        bulkUpdate(repeatersCMS, updatedRepeaters);
        bulkUpdate(happeningsCMS, updatedEvents);
        bulkInsert(happeningsCMS, newEvents);
        updateMenu(menuKey, month + " Newsletter");
        metaNewsletter.push(getFullNewsletter(allArticles));
        newsLetterToCMS(metaNewsletter);
})
})

})

function getFullNewsletter(allArticles){
  allArticles.shift();
  allArticles.shift();
  allArticles.shift();
  allArticles.shift();
  allArticles.shift();
  allArticles.shift();
return  {data:{
            title:"Newsletter",
            richcontent:{
              nodes: allArticles,
              documentStyle: {},
              metadata: {
                version: 1,
                createdTimestamp: `${timestamp}`,
                updatedTimestamp: `${timestamp}`
              }
            },
            longdescription:getLongDescriptionFromArticle(allArticles),
            sortOrder:999,
            month,
            generatedDescription:getLongDescriptionFromArticle(allArticles),
          }
        }
}

// ************************************
// this walks through the CC email constructs
// in order to find news articles
// we have some recursion here, it looks like
//
// <future>
// we could put more effort in here to work with formattings, font size, possibly images
//

function getMetaNewsletter(articles) {
  const newsletter = [];
  let sortOrder = 0;
  articles.forEach(subArticles=>{
  subArticles.forEach(article => {
    // console.log(pretty(article));
    // console.log(article[0]?.nodes[0]?.textData?.text?.trim() || "Untitled");
    // console.log((article[0].nodes.length === 2));
    let title = "";
    
    try {
        // Extract title from the first article node
        title = article[0]?.nodes[0]?.textData?.text?.trim() || "Untitled";
        if (article[0].nodes.length === 2) {
          console.log("extra title part",title, article[0].nodes[1]);
        }
        } catch (error) {
          console.error(error.message,"Error extracting title, article:", pretty(article[0]));
              return []; // Skip this article if extraction fails
        }
        article.shift();
        if (article.length == 0){
          //console.log("ZERO",title);
          return;
        }

      // Filter out any text-only nodes to create the content body
        let filteredArticle = article.filter(obj => obj.type !== "TEXT");
        sortOrder++;

        if (filteredArticle.length == 0) return;
        // console.log(pretty(filteredArticle))
        // stop();

      // Construct rich content object
        let richcontent = {
          nodes: filteredArticle,
          documentStyle: {},
          metadata: {
            version: 1,
            createdTimestamp: `${timestamp}`,
            updatedTimestamp: `${timestamp}`
          }
        };

      // Append additional content and generate descriptions
        filteredArticle.push(append3);
        const longdescription = getLongDescriptionFromArticle(filteredArticle);
        const generatedDescription = getGeneratedDescriptionFromArticle(filteredArticle);

      // Extract and format date if found
        let foundDate = extractFutureDate(longdescription);
        foundDate = foundDate ? formatDate(foundDate) : null;

      // Add entry to newsletter array
        newsletter.push({
          data: {
            title,
            richcontent,
            longdescription,
            sortOrder,
            month,
            generatedDescription,
            foundDate
          }
        });
      });
      });

  return newsletter;
}

async function newsLetterToCMS(content){
  const cmsFormat = content.map(item => ({
    data:{
      title:           item.data.title,
      richcontent:     item.data.richcontent,
      longPreview:     item.data.longdescription
    }
  }));

  bulkInsert(newsLetterCMS,cmsFormat);
}


function getServices(articles) { 
  const nodes = articles[2][1]
  const serviceContents = [];
  let nodeCount = 0;
  let text = "";
  const services = [];
  for (const node of nodes) {
    nodeCount++;
   if ((nodeCount) <5) continue;  // skipping over headings
   if (node.nodes.length == 0){
    text = ""; // probably a line break
   } else {
      let text2 = node.nodes.map(n => n.textData?.text).filter(Boolean).join(" ");
      const parts = text2.split(":");
      const beforeColon = parts[0].trim();
      const afterColon = parts.slice(1).join(":").trim();

      let dateExtracted = extractFutureDate(beforeColon);
      if (dateExtracted){
        node.extractedDate = dateExtracted;
        node.textDate = beforeColon;
        node.date = formatDate(dateExtracted);
        services.push(node)
      } else {
        console.log("No Date Found");
        break; // I think this means we're done with services
      }
   }
 }

  for (const service of services) {
    let content = parseService(service);
    serviceContents.push(content);
  }
  fs.writeFile('../services.js', JSON.stringify(nodes,null,2));
let update = [{data:{
          title:           "Sunday Service Update",
          richcontent: {nodes},
          longDescription: "Sunday Service Update"
        }}]

  bulkInsert(newsLetterCMS,update); // i hate this here
  return serviceContents;
}

function parseService(service){
  // a valid service entry must have a date in the first line
  const titleText = service.nodes
  .slice(0, 3)                               // Take only the first two nodes
  .filter(n => n.textData && n.textData.text) // Filter nodes with valid textData.text
  .map(n => n.textData.text)                 // Extract textData.text
  .join(' ')                                 // Join them into a single string
  .trim(); 

    const dateObject = service.extractedDate;
    const dateText  = service.textDate;
    let title = titleText.slice(dateText.length+2).trim();
    let longdescription = "";
    let richcontent = {
      nodes: [service,append3],
      documentStyle: {},
      metadata: {
        version: 1,
        createdTimestamp: `${timestamp}`,
        updatedTimestamp: `${timestamp}`
      }
    };
    let date = formatDate(service.extractedDate);
    longdescription = getLongDescriptionFromArticle([service]);
    const shortdescription = longdescription.slice(0,144)+"...";
    const isService = true;
    return {data:{title,isService,longdescription,date,richcontent}}
  }

function pretty(s){return JSON.stringify(s,null,2)}
function stop(){process.exit(0)}