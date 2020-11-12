// ==UserScript==
// @name         Keylol-Autorate
// @namespace    Keylol
// @include      https://keylol.com/forum.php
// @include      https://keylol.com/
// @require      https://code.jquery.com/jquery-3.5.1.min.js#sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0=
// @version      1.1.3-DreamNya
// @icon         https://raw.githubusercontent.com/DreamNya/Keylol-Autorate/DreamNya-patch-1/img/konoha.png
// @downloadURL	 https://github.com/DreamNya/Keylol-Autorate/raw/DreamNya-patch-1/keylol-autorate.user.js
// @updateURL	 https://github.com/DreamNya/Keylol-Autorate/raw/DreamNya-patch-1/keylol-autorate.user.js
// @description  Keylol forum autorate tool
// @author       DreamNya
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==
/*
更新日志：
1.version 1.0.8-DreamNya（2020-08-26）
a.在原作者ohperhaps 1.0.7版本基础上新增登陆论坛无需点击Autorate按钮自动加体力功能（首次使用需要手动点击按钮）。
b.增加Autorate按钮显示体力冷却倒计时功能（hh:mm:ss格式）。默认开启，每隔1000毫秒刷新一次。
  脚本编辑页面开头可自定义刷新时间const Autotime = 1000;（修改默认1000的为目标时间，单位毫秒，0为关闭显示）
c.修改脚本只有在论坛主页才会生效，以加快论坛加载速度。

2.version 1.0.9-DreamNya（2020-09-16）
a.修复冷却完毕时的计时器bug
b.新增加体力延迟、精确冷却倒计时功能
c.重写main()中获取帖子加体力的逻辑(未测试同时加多个收藏贴的功能 不推荐同时加多个收藏贴 可能存在bug)
d.存储已加体力tid pid信息，进一步优化加体力速度
e.存储运行日志，方便debug以及记录体力操作信息

3.version 1.1.0-DreamNya（2020-10-20）
a.修复毫秒显示bug
b.重写RateRecord，现pid tid已根据uid分类
c.增加定时刷新页面功能

4.version 1.1.1-DreamNya（2020-10-25）
a.增加检测脚本重复运行机制，防止多页面重复运行脚本导致加体力冲突
（如脚本异常退出，要使脚本正常运行需连续点击3次按钮，或手动修改脚本存储内容"Status": "On"为"Status": "Off",）

5.version 1.1.2-DreamNya（2020-11-05）
a.修复手动Autorate后的倒计时bug
b.修复对比pid记录bug

6.version 1.1.3-DreamNya (2020-11-12)
a.修复对比pid记录bug
b.优化获取时间函数

已知问题：
a.同时多个收藏贴只会平均体力，快加完其中一个时，不会优先加完。可能是1.0.9版本重写main()时存在逻辑问题。(暂无打算处理)

计划中：
a.增加存储debug信息开关。目前需要手动删除debug注释(暂无计划更新)
b.uid体力加完后一段时间自动清理(暂无计划更新)
c.加入可视化操作面板(计划下个版本更新)
d.每次增加体力前获取一次体力信息(暂无计划更新)
 */

const Autotime = 1000; //自定义体力冷却倒计时刷新周期，单位毫秒，0为关闭显示。
const HideAutorate = false; //显示体力冷却时是否隐藏Autorate文字 true:hh:mm:ss / false:Autorate hh:mm:ss
const delay = 5000; //自定义24小时体力冷却完毕后加体力延迟，单位毫秒
const PreciseCooldown = false; //精确体力冷却倒计时 false:只在初始化时获取一次冷却时间 true:每个刷新周期获取一次冷却时间
const refresh = 600000;//定时刷新页面，单位毫秒，0为不刷新。
//const debug = 3; //0:不存储除体力冷却体力操作以外的任何信息 1:存储有限debug信息 2:存储大量debug信息 3:1+2

(function() {
    'use strict';
    const $ = unsafeWindow.jQuery;
    const homePage = "https://keylol.com/";
    const selfUid = $("li.dropdown").find("a").attr("href").split("-")[1]
    const formHash = $("[name=formhash]").val();
    var auto_refresh=0 //记录脚本运行时间
    var debug_Error=0 //记录本次main()运行次数
    function xhrAsync (url, method="GET", data="") {
        if (method === "GET") {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    "method": "GET",
                    "url": homePage + url,
                    "onload": resolve
                })
            })
        } else if (method === "POST") {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    "method": "POST",
                    "url": homePage + url,
                    "data": data,
                    "onload": resolve
                })
            })
        }
    }
    function compare(property){
        return function(a,b){
            let value1 = a[property];
            let value2 = b[property];
            return value1 - value2;
        }
    }
    async function getUserScore() {
        let threads = await xhrAsync(`forum.php?mod=guide&view=newthread`).then((res) => {
            let threads = []
            $("div.bm_c", res.response).find("tbody").each(function () { threads.push($(this).attr("id").split("_").pop()) })
            return threads })
        for (let thread of threads) {
            let posts = await xhrAsync(`t${thread}-1-1`).then((res) => {
                let posts = []
                $("#postlist > div[id^=post_]", res.response).each(function () { posts.push($(this).attr("id").split("_").pop()) })
                return posts
            })
            for (let post of posts) {
                let ts = (new Date()).getTime()
                let score = await xhrAsync(`forum.php?mod=misc&action=rate&tid=${thread}&pid=${post}&infloat=yes&handlekey=rate&t=${ts}&inajax=1&ajaxtarget=fwin_content_rate`).then((res) => {
                    return $("table.dt.mbm td:last", res.response).text()
                })
                if (/^\d+$/.test(score)) { return parseInt(score) }
            }
        }
    }
    function getUserCredit(uid) {
        let creditBox = {
            "30": { step: 0},
            "31": { step: 0},
            "32": { step: 1},
            "33": { step: 2},
            "34": { step: 2},
            "35": { step: 3},
            "36": { step: 3},
            "37": { step: 4},
            "51": { step: 5},
            "52": { step: 0},
        }
        return Promise.all([xhrAsync(`suid-${uid}`), getUserScore()]).then((results) => {
            let gid = $("li:contains('用户组')", results[0].response).find("a").attr("href").split("=").pop()
            let credits = creditBox[gid] || { step: 4 }
            credits.total = results[1]
            return credits
        })
    }
    async function getCollections() {
        let collections = []
        for(let page = 1; page <= 40; page++) {
            let res = await xhrAsync(`plugin.php?id=keylol_favorite_notification:favorite_enhance&formhash=${formHash}&size=100&page=${page}`)
            let cs = $("#delform", res.response).find("tr")
            if (cs.length === 0) { break }
            else {
                cs.each(function () {
                    let quote = formatQuote($("span.favorite_quote.xi1", this).text())
                    if (quote) {
                        collections.push({favid: $(this).attr("id").split("_").pop(),
                                          uid: $("[href^='suid']", this).attr("href").split("-").pop(),
                                          username: $("[href^='suid']", this).text(),
                                          quote: quote[0],
                                          remain: quote[1],
                                          score: 0})
                    }
                })
            }
        }
        return collections.sort(compare('remain'))
    }
    function calcScores() {
        return Promise.all([getCollections(), getUserCredit(selfUid)]).then((results) => {
            let total = results[1].total
            let calcFlag = results[0].length > 0
            while(calcFlag) {
                for(let item of results[0]) {
                    if (total < 1) { calcFlag = false; break }
                    else {
                        if (item.score < item.remain) { item.score++; total-- }
                    }
                }
                if (results[0].every(item => item.score === item.remain)) { calcFlag = false }
            }
            results[0].forEach(function (item) {item.step = results[1].step})
            return [results[0], results[1].total]
        })
    }
    function getUserReplys(uid, page=1) {
        return xhrAsync(`home.php?mod=space&uid=${uid}&do=thread&view=me&from=space&type=reply&order=dateline&page=${page}`).then((res) => {
            let replys = []
            $("#delform", res.response).find("td.xg1").each(function () {
                let urlParams = new URLSearchParams($(this).find("a").attr("href"))
                replys.push({tid: urlParams.get("ptid"),
                             pid: urlParams.get("pid")})
            })
            return replys
        })

    }
    function formatQuote(quote, addend=0) {
        let quote_num = quote.match(/\d+/g)
        if (/^\d+\/\d+$/.test(quote) && parseInt(quote_num[0]) < parseInt(quote_num[1])) {
            return [(parseInt(quote_num[0]) + parseInt(addend)).toString() + '/' + quote_num[1].toString(), (parseInt(quote_num[1]) - parseInt(quote_num[0]) - parseInt(addend))]
        }
    }
    function updateQuote(favid, quote) {
        const formData = new FormData()
        let time = [new Date().getFullYear(),check(new Date().getMonth()+1),check(new Date().getDate())].join('-')+' '+[new Date().getHours(),check(new Date().getMinutes()),check(new Date().getSeconds()),check_mil(new Date().getMilliseconds())].join(':')
        //GM_setValue(time+' updateQuote',[favid, quote])
        formData.append("favid", favid)
        formData.append("quote", quote)
        return xhrAsync(`plugin.php?id=keylol_favorite_notification:favorite_enhance&formhash=${formHash}`, "POST", formData).then((res) => {
            //GM_setValue(time+' updateQuoteres',res)
            //GM_setValue(time+' updateQuoteres.responseText',res.responseText)
            return res.responseText
        })
    }
    function rate(tid, pid, score, reason) {
        const formData = new FormData()
        formData.append("formhash", formHash)
        formData.append("tid", tid)
        formData.append("pid", pid)
        formData.append("referer", `${homePage}forum.php?mod=viewthread&tid=${tid}&page=0#pid${pid}`)
        formData.append("handlekey", "rate")
        formData.append("score1", score)
        formData.append("reason", reason)
        return xhrAsync(`forum.php?mod=misc&action=rate&ratesubmit=yes&infloat=yes&inajax=1`, "POST", formData).then((res) => {
            if (res.responseText.indexOf('succeedhandle_rate') !== -1) {
                return ('successful')
            } else if (res.responseText.indexOf('errorhandle_rate') && res.responseText.indexOf('24 小时评分数超过限制') !== -1) {
                return ('exceeded')
            } else if (res.responseText.indexOf('errorhandle_rate') && res.responseText.indexOf('您不能对同一个帖子重复评分') !== -1) {
                return ('failed')
            } else {
                return ('Unknown')
            }
        })
    }
    async function main() {
        let message = []
        let itemScores = await calcScores()
        let page =1
        let RateRecord=GM_getValue('RateRecord',[]) //读取tid pid记录
        let i=0 //根据uid获取RateRecord存储序号
        let mark=false //正常运行标记
        let status = GM_getValue('Status',"Off") //检测加体力状态 防止重复运行
        if (status == "Off"){
            GM_setValue('Status',"On") //防止重复运行标记
            //GM_setValue(getDate()+' itemScores',itemScores)
            if (itemScores[0].length === 0) {
                message.push('未找到正确格式的收藏帖子！\n')
                GM_setValue(getDate()+' result','未找到正确格式的收藏帖子！')
            }
            while (itemScores[0].length >0){
                if (itemScores[1] === 0) {
                    message.push('当前无剩余体力！请稍后再尝试！\n')
                    GM_setValue(getDate()+' result','当前无剩余体力！请稍后再尝试！')
                    break
                }else{
                    mark=true
                    body:
                    while(page<51){
                        let replys = await getUserReplys(itemScores[0][0].uid, page)
                        hand:
                        while (replys.length > 0 ){
                            //GM_setValue(getDate()+' itemScores[0][0].uid, page, replys',[itemScores[0][0].uid, page, replys])
                            if (itemScores[0][0].score > 0) { //剩余体力
                                let attend = Math.min(itemScores[0][0].step, itemScores[0][0].score) //每次加体力数
                                let new_quote = formatQuote(itemScores[0][0].quote, attend)[0] //体力说明计数
                                let tid=[]
                                let pid=[]
                                if (RateRecord.length>0){
                                    i=getRateRecord(RateRecord,itemScores[0][0].uid) //读取uid记录
                                    if (i > -1){
                                        tid=RateRecord[i].tid //读取tid记录
                                        pid=RateRecord[i].pid //读取pid记录
                                    } else{
                                        RateRecord.push({uid:itemScores[0][0].uid,
                                                         tid:tid,
                                                         pid:pid})
                                        i=RateRecord.length-1
                                    }
                                    for (let Record of pid){ //对比pid记录 存在则直接跳过 减少POST
                                        if (replys[0].pid == Record){
                                            replys.shift()
                                            //GM_setValue(getDate()+' replys,replys.length',[replys,replys.length])
                                            if (!replys.length>0){
                                                break hand
                                            }
                                        }
                                    }
                                }else{
                                    RateRecord=[{uid:itemScores[0][0].uid,
                                                 tid:tid,
                                                 pid:pid}]
                                    i=0
                                }
                                let rate_result = await rate(replys[0].tid, replys[0].pid, attend, new_quote)
                                /*GM_setValue(getDate()+" rate_log",{replys_tid: replys[0].tid,
                                                          replys_pid: replys[0].pid,
                                                          attend: attend,
                                                          new_quote: new_quote,
                                                          rate_result: rate_result})*/
                                if (rate_result === 'successful') {
                                    itemScores[0][0].score -= attend
                                    itemScores[0][0].quote = new_quote
                                    //GM_setValue(getDate()+" successful itemScores[0][0].score",itemScores[0][0].score)
                                    //GM_setValue(getDate()+" successful itemScores[0][0].quote",itemScores[0][0].quote)
                                    GM_setValue('Ratetime', new Date().getTime()) //记录加体力时间
                                    Cooldown = 86400000+delay
                                    GM_setValue(getDate()+" rate",`user: ${itemScores[0][0].username} tid: ${replys[0].tid}  pid: ${replys[0].pid} score: ${attend} reason:${new_quote}`) //记录加体力结果
                                    message.push(`user: ${itemScores[0][0].username} tid: ${replys[0].tid}  pid: ${replys[0].pid} score: ${attend} reason:${new_quote}\n`)
                                    //updateQuote(itemScores[0][0].favid, itemScores[0][0].quote)
                                } else if (rate_result === 'exceeded') {
                                    //GM_setValue(getDate()+" exceeded itemScores[0][0].score",itemScores[0][0].score)
                                    //GM_setValue(getDate()+" exceeded itemScores[0][0].quote",itemScores[0][0].quote)
                                    updateQuote(itemScores[0][0].favid, itemScores[0][0].quote)
                                    GM_setValue(getDate()+' result','当前体力已全部加完!')
                                    message.push('当前体力已全部加完!\n')
                                    break body
                                }
                                RateRecord[i].tid.unshift(replys[0].tid) //记录本次tid
                                RateRecord[i].pid.unshift(replys[0].pid) //记录本次pid
                            }else {
                                //GM_setValue(getDate()+" end itemScores[0][0].score",itemScores[0][0].score)
                                //GM_setValue(getDate()+" end itemScores[0][0].quote",itemScores[0][0].quote)
                                updateQuote(itemScores[0][0].favid, itemScores[0][0].quote) //*可能存在page=50 score>0不更新的bug
                                break body
                            }
                            replys.shift() //加下一个体力
                        }
                        ++page
                    }
                }
                itemScores[0].shift() //加下一个收藏贴体力 *未测试存在多个收藏贴的情况 可能存在bug；如有bug可以手动多次运行
            }
            if(mark){GM_setValue('RateRecord',RateRecord)}
            GM_setValue('Status',"Off")
            alert(message.join(''))
            if(Timer == null){Timer = setInterval(AutoTimer,Autotime)} //重启倒计时冷却
        }else{
            clearInterval(Timer)
            Timer = null
            GM_setValue(getDate()+' Error','检测到脚本重复运行')
            debug_Error++
            if(debug_Error>=2){GM_setValue('Status',"Off")}
            alert("Error 检测到脚本重复运行\n如脚本异常退出清再点击"+(3-debug_Error)+"次按钮强制运行脚本\n")
        }
    }

    function getDate(){
        return [new Date().getFullYear(),check(new Date().getMonth()+1),check(new Date().getDate())].join('-')+' '+[check(new Date().getHours()),check(new Date().
getMinutes()),check(new Date().getSeconds()),check_mil(new Date().getMilliseconds())].join(':')
    }
    function getRateRecord(RateRecord,uid){ //读取uid记录
        let i = 0
        for (let Record of RateRecord){
            if (Record.uid == uid) {
                return i
            }
            ++i
        }
        return -1
    }

    function views() {
        let rateDiv = $('<div/>', {id: 'rateDiv'})
        let rateBtn = $('<a/>', {
            id: 'autoRate',
            html: 'Autorate',
            class: 'btn btn-user-action',
            mouseover: function () { $(this).css({'background-color': '#57bae8', 'color': '#f7f7f7'}) },
            mouseleave: function () { $(this).css({'background-color': '', 'color': ''}) },
            click: function () { main() }})
        rateDiv.append(rateBtn)
        $('#nav-search-bar').after(rateDiv)
    }
    function check(val) { //优化显示体力冷却时间
        if (val < 10) {
            return ("0" + val)
        }
        else{
            return (val)
        }
    }
    function check_mil(val) { //优化显示体力冷却时间(毫秒)
        if (val < 10) {
            return ("00" + val)
        }
        else if (val<100){
            return ("0" + val)
        }
        else{
            return (val)
        }
    }
    function AutoTimer() { //自动加体力
        if (PreciseCooldown){
            Cooldown=GM_getValue('Ratetime')+86400000+delay-new Date().getTime()
        }else{
            Cooldown -=Autotime
        }
        let Hour = Math.floor(Cooldown/1000/3600)
        let Minute = Math.floor((Cooldown-Hour*1000*3600)/1000/60)
        let Second = Math.floor((Cooldown-Hour*1000*3600-Minute*1000*60)/1000)
        let time =[check(Hour),check(Minute),check(Second)].join(':')
        if (Cooldown <0) { //判断体力冷却是否结束
            let time_debug =new Date().getTime()
            Cooldown=GM_getValue('Ratetime')+86400000+delay-time_debug //精确冷却时间
            let status = GM_getValue('Status',"Off") //检测加体力状态 防止重复运行
            if (Cooldown <1){
                //GM_setValue(time_debug, Cooldown) //记录加体力时间
                clearInterval(Timer)
                Timer = null
                main()
            }else{
                location.reload()
            }
        }
        else if(Cooldown > 1 && Autotime > 0 ){ //体力冷却中
            if (HideAutorate == false) { //显示体力冷却时间
                $('#autoRate').html('Autorate<br/>'+time)
            }
            else{
                $('#autoRate').html(time)
            }
            if(Timer == null){
                Timer = setInterval(AutoTimer,Autotime) //设置显示体力冷却时间计时器
            }
        }
        auto_refresh+=Autotime
        if (auto_refresh > refresh && refresh > 0){location.reload()}
    }
    views()
    let init = GM_getValue('Ratetime')
    if (init){
        var Cooldown=init+86400000+delay-new Date().getTime() //获取体力冷却时间
        var Timer = null
        AutoTimer()
        //debugpid()
    }

    function debugpid() { //清除因旧版本bug导致RateRecord重复记录内容，新版本已修复
        let RateRecord=GM_getValue('RateRecord',[])
        for (let i=0;i<RateRecord.length;i++){
            for (let n=0;n<RateRecord[i].pid.length;n++){
                for (let t=n+1;t<RateRecord[i].pid.length;t++){
                    if (RateRecord[i].pid[n]==RateRecord[i].pid[t]){
                        RateRecord[i].pid.splice(t,1)
                        RateRecord[i].tid.splice(t,1)
                    }
                }
            }
        }
        GM_setValue('RateRecord',RateRecord)
    }
})();