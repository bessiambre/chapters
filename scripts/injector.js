/* global $, Cookies, console, require, CodeMirror, _ */

var js_outmirror = null,
    exec_outmirror = null,
//    church_to_js = require("./church_to_js").church_to_js,
    church_builtins = require("./church_builtins"),
    pr = require("./probabilistic/index"),
    util = require("./probabilistic/util"),
    transform = require("./probabilistic/transform"),
    format_result = require("./evaluate").format_result,
    evaluate = require("./evaluate").evaluate

//var format_result = require("./format_result").format_result;

util.openModule(pr);
//util.openModule(church_builtins);

//var myRangeFinder = function(cm,pos) {
//    
//    return {from: CodeMirror.Pos(pos.line, 0),
//        to: CodeMirror.Pos(pos.line+2, 0)};
//}

CodeMirror.keyMap.default["Tab"] = "indentAuto";
CodeMirror.keyMap.default["Cmd-/"] = "toggleComment";
CodeMirror.keyMap.default["Cmd-."] = function(cm){cm.foldCode(cm.getCursor(), myRangeFinder); }


// if not logged in, start an anonymous session
if (!Cookies.get('csrftoken')) {
  $.ajax({
    type: "GET",
    url: "/session"
  });
}

var forest_protocol = location.protocol.match(/file/) ? "http://" : "//";

(function() {
  // wait till server hands us back a code_id and then
  // submit the result
  var submitResult = function(data, editor) {
    if (editor.codeId) {
      var submitData = _(data).extend({'code_id': editor.codeId});

      // asynchronously POST church results to /result/{exercise_name}
      $.ajax({
        type: "POST",
        url: "/result",
        data: data,
        success: function() { console.log("POST to /result/" + editor.exerciseName + ": success");},
        error: function() { console.log("POST to /result/" + editor.exerciseName + ": failure");}
      }); 
    } else {
      setTimeout(function() { submitResult(data, editor) }, 100);
    }
  };
  
  var runners = {};
  runners['webchurch'] = makewebchurchrunner();
  runners['webchurch-opt'] = makewebchurchrunner(true);
 
  function makewebchurchrunner(evalparams){
   return function(editor) {
    var code = editor.getValue(),
        exerciseName = editor.exerciseName,
        $results = editor.$results,
        resultData = {'exercise_id': editor.exerciseName,
                      'csrfmiddlewaretoken': Cookies.get('csrftoken')
                     };

    $results.show();
    if (editor.errormark != undefined){editor.errormark.clear()}
    try {
//      var jsCode = church_to_js(code);
//      jsCode = transform.probTransform(jsCode);
//      var runResult = eval(jsCode),
 
      var runResult = evaluate(code,evalparams)
 
      var underlyingData
      
      if (typeof runResult == "function") {
        // otherwise, call the function with the current div as an argument
        underlyingData = runResult($results);
        //underlyingData = format_result(runResult($results));
      }
      else {
//        runResult = format_result(runResult);
        // if we get back a string, just show the text
        underlyingData = runResult;
        runResult = format_result(runResult);
        $results.removeClass("error").text(runResult);
      } 

       resultData['forest_results'] =  JSON.stringify(underlyingData); 
      
    } catch (e) {
 
      var error = e.message;
      $results.addClass("error").text( error );
 
      if (e.start) {
        $results.append("\nStack trace: " + e.stack );
 
//        var errorlocation = e.stackarray[0]
//        var start=errorlocation.start.split(":"), end=errorlocation.end.split(":")
        var start=e.start.split(":"), end=e.end.split(":")
        editor.errormark = editor.markText({line: Number(start[0])-1, ch: Number(start[1])-1},
                            {line: Number(end[0])-1, ch: Number(end[1])},
                                   {className: "CodeMirrorError", clearOnEnter: true})
//        mark.clear()
    }

      resultData['forest_errors'] = error;
    }

    // start trying to submit results
    submitResult(resultData, editor);

 }};

  var query_settings = {
    method: 'get',          // method; get or post
    data: '',               // array of values to be passed to the page - e.g. {name: "John", greeting: "hello"}
    minTimeout: 300,        // starting value for the timeout in milliseconds
    maxTimeout: 8000,       // maximum length of time between requests
    multiplier: 2,          // if set to 2, timerInterval will double each time the response hasn't changed (up to maxTimeout)
    type: 'jsonp',           // response type - text, xml, json, etc.  See jq.ajax config options
    maxCalls: 0,            // maximum number of calls. 0 = no limit.
    autoStop: 0            // automatically stop requests after this many returns of the same data. 0 = disabled.
  };

  function query_url(task_id){
    return forest_protocol + 'forestbase.com/api/query/' + task_id + '/';
  };

  function query_stop_url(task_id){
    return forest_protocol + 'forestbase.com/api/query/stop/' + task_id + '/';
  };

  function query_update(task_id, handlers){
    $.ajax({ url : query_url(task_id),
              type : 'json',
              method: 'get',
              success: function(json){
//                signal_handlers(json, handlers);
              }});
  };

  function query_stop(task_id, handlers){
    $.get(
      query_stop_url(task_id),
      {},
      function(json) {
//        signal_handlers(json, handlers);
      },
      "jsonp"
    );
  };

  function query_periodicalupdater(task_id, handlers){
    function query_receiver(json) {
      if (json.status == "done") {
        console.log(json.status);
        updater.stop();
        _(handlers).each(function(handler) {
          handler(json);
        });
      }
    };
    var updater = $.PeriodicalUpdater(query_url(task_id), query_settings, query_receiver);
  };

  var forestRunner = function(editor) {

    var exerciseName = editor.exerciseName,
        code = editor.getValue(),
        $results = editor.$results,
        engine = editor.engine,
        $runButton = editor.$runButton;

    var handlers = {};
   
    // NB: debugger statement doesn't work quite right here...
    // i don't get access to, e.g., exerciseName in debugger
    handlers.error = function(json) {
      if (json.errors.length > 0) {
        var errorString = json.errors.join("\n");
        $results.addClass('error').html(errorString);
      } else {
        $results.removeClass('error');
      }
    };

    handlers.textOutAndResult = function(json) {
      var resultString = "";
      if (json.data && json.data.result && json.data.result.base) {
        resultString += json.data.result.base.values.join("\n");
      }

      if (json.text && json.text != "\n\n") {
        resultString += json.text;
      }

      $results.html(resultString).show();
      
    }; 


    handlers.hist = function(json) {
      if (json.data && json.data.hist && _(json.data.hist).keys().length > 0) {

        var histDatas = _(json.data.hist).values();
        _(histDatas).each(function(histData) {
          var title = histData.attributes.title,
              counts = histData.counts;

          // cosh returns a histogram where counts are probabilities
          // convert this to an approximate count
          if (engine == "cosh") {
            _(histData.counts).each(function(prob, key) {
              counts[key] = Math.round(prob * 1000);
            });
          }

          // for compatibility with _hist,
          // convert summary counts back into
          // a full data structure
          var samps = Array.prototype.concat.apply([],
                                                   _(counts).map(function(count, key) {
                                                     var arr = [];
                                                     while (count--) {
                                                       arr.push(key);
                                                     }
                                                     return arr; 
                                                   })
                                                  ),
              // convert from array to list (this is convoluted)
              sampsList = arrayToList(samps); 

          var histPlotter = hist(sampsList, title);
          histPlotter($results);
        });
      }
      
    };

    handlers.postResult = function(json) {
      var data = {'exercise_id': exerciseName,
                  'csrfmiddlewaretoken': Cookies.get('csrftoken'),
                  'forest_results': JSON.stringify(json.data)
                 };
      if (json.errors.length > 0) {
        data.forest_errors = JSON.stringify(json.errors);
      }

      submitResult(data, editor); 
    };

    handlers.reenableRun = function(json) {
      editor.$runButton.removeAttr('disabled');
    };

    $.get(forest_protocol + "forestbase.com/api/query/",
           {"code": code, "engine": engine},
           function(json) {
             if (json.status == "submitted") {
               // load_handlers(handlers);
               query_periodicalupdater(json.task_id, _(handlers).values() );
             }
           },
           "jsonp");

  };

  runners['cosh'] = forestRunner;
  runners['mit-church'] = forestRunner;
  runners['bher'] = forestRunner; 

  // we can't use Cookies.get('sessionid') because that's an HTTPOnly
  // cookie - it can't be read by client-side javascript
  var loggedIn = Cookies.get("gg") || false;

  // return a dictionary of DOM element attributes
  var getAttributes = function(x) {
    var attributes = {};
    // extract all info from 
    for(var i = 0, ii = x.attributes.length; i < ii; i++) {
      var attr = x.attributes.item(i),
          name = attr.name,
          value = attr.value;
      
      attributes[name] = value;
    }
    return attributes;
  };


  // this is potentially set in play-space-list.html,
  // which is a temporary file that will eventually supplant
  // play-space.html after testing on the server
  if (typeof window.chapterName == "undefined") {
    chapterName = _(location.href.split("/")).last().replace(".html","").split("#")[0];
  }

  var injectEditor = function(domEl, options) {
    var attributes = getAttributes(domEl),
        text = options.text,
        defaultText = options.defaultText,
        selectedEngine = options.engine,
        exerciseName = options.exerciseName;
    
    // editor
    var editor = CodeMirror(
      function(el) {
        // var $ioContainer = $("<div class='io'></div");
        $(domEl).replaceWith(el);
      },
      {
        value: text,
        lineNumbers: false,
        matchBrackets: true,
        continueComments: "Enter",
        viewportMargin: Infinity,
        autoCloseBrackets: true
      });

    _(editor).extend(options);
 
 //fold ";;;fold:" parts:
 var lastLine = editor.lastLine();
 for(var i=0;i<=lastLine;i++) {
    var txt = editor.getLine(i),
        pos = txt.indexOf(";;;fold:");
   if (pos==0) {editor.foldCode(CodeMirror.Pos(i,pos),trippleCommentRangeFinder);}
 }
 
    // results div
    var $results = $("<pre class='results'>");
    $results.css('display', 'none');

    // engine selector

    var engines = ["webchurch", "webchurch-opt", "cosh", "bher", "mit-church"],
        engineSelectorString = "<select>\n" + _(engines).map(
          function(engine) {
            var tmpl = _.template('<option value="{{ engine }}" {{ selectedString }}> {{ engine }} </option>'),
                str = tmpl({
                  engine: engine,
                  selectedString: engine == editor.engine ? "selected" : ""
                });

            return str; 
          } 
        ).join("\n") + "\n</select>",
        $engineSelector = $(engineSelectorString);
    
    $engineSelector.change(function(e) {
      editor.engine = $(this).val();
    });

    // reset button
    var $resetButton = $("<button>").html("Reset");
    $resetButton.click(function() {
      editor.setValue(defaultText);
      editor.$engineSelector.val(editor.defaultEngine);
      
      $results.hide().html('');
      $.ajax({
        type: "POST",
        url: "/code/" + editor.exerciseName,
        data: {
          'code': defaultText,
          'engine': editor.engine,
          'isRevert': 1,
          'csrfmiddlewaretoken': Cookies.get('csrftoken')
        },
        success: function(codeId) {
          console.log("POST to /code/" + editor.exerciseName + ": success");
          editor.codeId = codeId;
        },
        error: function() {
          console.log("POST to /code/" + editor.exerciseName + ": failure");
        }
      });


    });

    // run button
    var $runButton = $("<button class='run'>").html("Run");
    $runButton.click(function() {
      $results.html('');
      $runButton.attr('disabled','disabled');

      var newCode = editor.getValue(),
          newEngine = editor.engine;

      // submit church code to accounts server if the
      // code has actually changed or we're running
      // with a different engine
      if (editor.oldCode != newCode || editor.oldEngine != newEngine) {
        // unset editor.codeId
        editor.codeId = false;
        
        // asynchronously POST church code to /code/{exercise_name}
        $.ajax({
          type: "POST",
          url: "/code/" + editor.exerciseName,
          data: {
            'code': newCode,
            'engine': newEngine,
            'isRevert': null,
            'csrfmiddlewaretoken': Cookies.get('csrftoken')
          },
          success: function(codeId) {
            console.log("POST to /code/" + editor.exerciseName + ": success");
            editor.codeId = codeId;
          },
          error: function() {
            console.log("POST to /code/" + editor.exerciseName + ": failure");
          }
        });
      }

      editor.oldCode = newCode;
      editor.oldEngine = newEngine;

      // use runner on this editor
      // use setTimeout so the run-button disabling actually
      // shows up on the DOM
      setTimeout(function() { runners[editor.engine](editor);
                              if (editor.engine == "webchurch" || editor.engine == "webchurch-opt") {
                                $runButton.removeAttr('disabled');
                              }
                            }, 15);
    });

    var $codeControls = $("<div class='code-controls'>");
    // HT http://somerandomdude.com/work/open-iconic/#
    var $settingsMenu = $("<ul class='code-settings'>");
    $settingsMenu.append(
      $('<li class="cog">').append( "<button><img src='cog_32x32.png' width=11 height=11></button>" ),
      $('<li>').append( $resetButton[0] ),
      $('<li>').append( $engineSelector[0] )
    ); 

    $codeControls.append($settingsMenu);
    
    $(editor.display.wrapper).prepend($codeControls, $runButton);
    // var $settingsMenu = $("<div class='settings-menu'>");
    // $settingsMenu.append( $engineSelector, $resetButton); 

    // add non-codemirror bits after codemirror
    $(editor.display.wrapper).attr("id", "ex-"+ exerciseName).after( $results );
    
    editor.$runButton = $runButton;
    editor.$engineSelector = $engineSelector;
    editor.$resetButton = $resetButton;
    editor.$results = $results;
    
  };

  $(document).ready(function() {
    $("pre:not(.norun)").map(function(index, item) {
      var rawExerciseName = $(item).attr("data-exercise"),
          defaultEngine = $(item).attr("data-engine") || 'webchurch',
          defaultText = $(item).text(),
          exerciseName;

      if (typeof rawExerciseName == "undefined") {
        exerciseName = [chapterName, index, md5(defaultEngine + defaultText)].join(".");
      } else {
        exerciseName = [chapterName, rawExerciseName].join(".");
      }
      

      // default options which get over-ridden
      // if this box has an exerciseName
      var editorOptions = {
        exerciseName: exerciseName,
        defaultText: defaultText,
        boxNum: index,
        text: defaultText,
        defaultEngine: defaultEngine,
        engine: defaultEngine
      };
      
      if (!loggedIn || !rawExerciseName) {
        injectEditor(item, editorOptions); 
      } else {
        
        $.ajax({
          url: "/code/" + exerciseName,
          success: function(json) {
            // overwrite defaults
            _(editorOptions).extend({
              text: json.code,
              engine: json.engine
            });

            injectEditor(item, editorOptions);
          },
          error: function() {
            console.log("failure loading exercise " + exerciseName + ", using default");
            injectEditor(item, editorOptions);
          }
        });

        
      }
    });
  });

})();
