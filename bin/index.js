#!/usr/bin/env node

const axios = require('axios')
const fs = require('fs')
const temp = require('temp')
const xls = require('xlsjs')
const csv2json = require('csvtojson')

const AF_URL = 'https://arbetsformedlingen.se'
const URL = 'https://arbetsformedlingen.se/om-oss/statistik-och-analyser/statistik'


const downloadFile = (url) => {
    return new Promise((resolve, reject) => {
        axios.get(url, { responseType: "stream" }).then(response => {
            let stream = temp.createWriteStream()
            response.data.pipe(stream)
            setTimeout(() => {
                resolve(stream.path)
            }, 500)
        })
    })
}

const findDownloadableFiles = () => {
    return new Promise((resolve, reject) => {
        axios.get(URL).then((response) => {
            const regExp = /(\/download.*?varsel.*?)\"/gmi
            const matches = response.data.match(regExp)
            let urls = []

            for (let i in matches) {
                const url = AF_URL + matches[i].substr(0, matches[i].length - 1)
                const filename = url.substr(url.lastIndexOf('/') + 1)

                if (mostRecentFiles("riket", filename)) {
                    urls.riket = {
                        url: url,
                        filename: filename
                    }
                }

                else if (mostRecentFiles("lan", filename)) {
                    urls.lan = {
                        url: url,
                        filename: filename
                    }
                }
            }
            return resolve(urls)
        })
    })    
}

const mostRecentFiles = (type, filename) => {
    const dateString = () => {
        const d = new Date()
    
        let m = d.getMonth() + 1;
        
        if (m < 10) {
            m = 0 + "" + m
        }
    
        return d.getFullYear() + "-" + m;
    }

    return filename.match(new RegExp(type + ".*?" + dateString()))
}

const toNumber = (str) => {
    str = str.replace(",", "").replace(" ", "")
    return Number(str)
}

const parseRiket = (file) => {
    return new Promise((resolve, reject) => {
        let workbook = xls.readFile(file)
        let csv = xls.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]])
        const matchTable = new RegExp(/SNI.*(.*|[\s\S]*)Summa/)
        const table = csv.match(matchTable, "mg")[0];
        
        csv2json({ noheader: true }).fromString(table).then((rows) => {

            let statistics = []
            
            let count = 0;

            rows.forEach((row) => {

                if (count++ < 1) {
                    return
                }

                if (row.field2 == undefined) {
                    return
                }

                statistics.push({
                    yrkesomrade: row.field2,
                    data: {
                        uppsagningar: {
                            varsel: toNumber(row.field3),
                            berorda_personer: toNumber(row.field4)
                        },
                        permitteringar: {
                            varsel: toNumber(row.field7),
                            berorda_personer: toNumber(row.field8)
                        }
                    }
                })
            })

            resolve({riket: statistics})
        })

    })
}

const parseLan = (file) => {
    return new Promise((resolve, reject) => {
        let workbook = xls.readFile(file)
        let csv = xls.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]])
        const matchTable = new RegExp(/((.+(\d{4}\-\d{2},)+?)(.|[\s\S])*?)Källa/)
        const table = csv.match(matchTable, "mg")[1];
        
        csv2json({ noheader: true }).fromString(table).then((rows) => {

            let statistics = []
            let dates = [
                rows[0].field3,
                rows[0].field4,
                rows[0].field5
            ]

            let count = 0;
        
            rows.forEach((row) => {

                if (count++ < 1) {
                    return
                }

                if (row.field2.length <= 0) {
                    return
                }

                statistics.push({
                    lan: row.field2,
                    data: [
                        { berorda_personer: toNumber(row.field3), datum: dates[0] },
                        { berorda_personer: toNumber(row.field4), datum: dates[1] },
                        { berorda_personer: toNumber(row.field5), datum: dates[2] }
                    ]
                })
            })

            resolve({lan: statistics})
        })

    })
}

const args = process.argv.slice(2)

if (!args.length) {
    console.log("Specify an ouput")
    return
}

output = args[0]

findDownloadableFiles().then((files) => {

    // Track temporary files
    temp.track()

    promises = [
        downloadFile(files.riket.url).then((filename) => parseRiket(filename)),
        downloadFile(files.lan.url).then((filename) => parseLan(filename))
    ]
    
    Promise.all(promises).then((response) => {
        fs.writeFile(output, JSON.stringify(response), (err) => {
            if (err) {
                console.log(err)
            }

            console.log("File saved as " + output)

            // Clean up temporary files
            temp.cleanupSync()
        })
    })
})