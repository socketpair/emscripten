//"use strict";

// LLVM assembly => internal intermediate representation, which is ready
// to be processed by the later stages.

// Line tokenizer
function tokenizer(item, inner) {
  //assert(item.lineNum != 40000);
  //if (item.lineNum) print(item.lineNum);
  var tokens = [];
  var quotes = 0;
  var lastToken = null;
  var CHUNKSIZE = 64; // How much forward to peek forward. Too much means too many string segments copied
  // Note: '{' is not an encloser, as its use in functions is split over many lines
  var enclosers = {
    '[': 0,
    ']': '[',
    '(': 0,
    ')': '(',
    '<': 0,
    '>': '<'
  };
  var totalEnclosing = 0;
  function makeToken(text) {
    if (text.length == 0) return;
    // merge certain tokens
    if (lastToken && ( (lastToken.text == '%' && text[0] == '"') || /^\**$/.test(text) ) ) {
      lastToken.text += text;
      return;
    }

    var token = {
      text: text
    };
    if (text[0] in enclosers) {
      token.item = tokenizer({
        lineText: text.substr(1, text.length-2)
      }, true);
      token.type = text[0];
    }
    // merge certain tokens
    if (lastToken && isType(lastToken.text) && isFunctionDef(token)) {
      lastToken.text += ' ' + text;
    } else if (lastToken && text[0] == '}') { // }, }*, etc.
      var openBrace = tokens.length-1;
      while (tokens[openBrace].text.substr(-1) != '{') openBrace --;
      token = combineTokens(tokens.slice(openBrace+1));
      tokens.splice(openBrace, tokens.length-openBrace+1);
      tokens.push(token);
      token.type = '{';
      token.text = '{ ' + token.text + ' }';
      var pointingLevelsToAdd = pointingLevels(text) - pointingLevels(token.text);
      while (pointingLevelsToAdd > 0) {
        token.text += '*';
        pointingLevelsToAdd--;
      }
      lastToken = token;
    } else {
      tokens.push(token);
      lastToken = token;
    }
  }
  // Split using meaningful characters
  var lineText = item.lineText + ' ';
  var re = /[\[\]\(\)<>, "]/g;
  var segments = lineText.split(re);
  segments.pop();
  var len = segments.length;
  var i = -1;
  var curr = '';
  var segment, letter;
  for (var s = 0; s < len; s++) {
    segment = segments[s];
    i += segment.length + 1;
    letter = lineText[i];
    curr += segment;
    switch (letter) {
      case ' ':
        if (totalEnclosing == 0 && quotes == 0) {
          makeToken(curr);
          curr = '';
        } else {
          curr += ' ';
        }
        break;
      case '"':
        if (totalEnclosing == 0) {
          if (quotes == 0) {
            if (curr == '@' || curr == '%') {
              curr += '"';
            } else {
              makeToken(curr);
              curr = '"';
            }
          } else {
            makeToken(curr + '"');
            curr = '';
          }
        } else {
          curr += '"';
        }
        quotes = 1-quotes;
        break;
      case ',':
        if (totalEnclosing == 0 && quotes == 0) {
          makeToken(curr);
          curr = '';
          tokens.push({ text: ',' });
        } else {
          curr += ',';
        }
        break;
      default:
        assert(letter in enclosers);
        if (quotes) {
          curr += letter;
          break;
        }
        if (letter in ENCLOSER_STARTERS) {
          if (totalEnclosing == 0) {
            makeToken(curr);
            curr = '';
          }
          curr += letter;
          enclosers[letter]++;
          totalEnclosing++;
        } else {
          enclosers[enclosers[letter]]--;
          totalEnclosing--;
          if (totalEnclosing == 0) {
            makeToken(curr + letter);
            curr = '';
          } else {
            curr += letter;
          }
        }
    }
  }
  var newItem = {
    tokens: tokens,
    indent: lineText.search(/[^ ]/),
    lineNum: item.lineNum
  };
  return newItem;
}

function tokenize(text) {
  return tokenizer({ lineText: text }, true);
}

// Handy sets

var ENCLOSER_STARTERS = set('[', '(', '<');
var ENCLOSER_ENDERS = {
  '[': ']',
  '(': ')',
  '<': '>'
};
var ZEROINIT_UNDEF = set('zeroinitializer', 'undef');
var NSW_NUW = set('nsw', 'nuw');

// Intertyper

function intertyper(lines, sidePass, baseLineNums) {
  var mainPass = !sidePass;
  baseLineNums = baseLineNums || [[0,0]]; // each pair [#0,#1] means "starting from line #0, the base line num is #1"

  dprint('framework', 'Big picture: Starting intertyper, main pass=' + mainPass);

  var finalResults = [];

  // Line splitter. We break off some bunches of lines into unparsed bundles, which are
  // parsed in separate passes later. This helps to keep memory usage low - we can start
  // from raw lines and end up with final JS for each function individually that way, instead
  // of intertyping them all, then analyzing them all, etc.
  function lineSplitter() {
    var ret = [];
    var inContinual = false;
    var inFunction = false;
    var currFunctionLines;
    var currFunctionLineNum;
    var unparsedTypes, unparsedGlobals;
    if (mainPass) {
      unparsedTypes = {
        intertype: 'unparsedTypes',
        lines: []
      };
      finalResults.push(unparsedTypes);
      unparsedGlobals = {
        intertype: 'unparsedGlobals',
        lines: []
      };
      finalResults.push(unparsedGlobals);
    }
    var baseLineNumPosition = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (singlePhase) lines[i] = null; // lines may be very very large. Allow GCing to occur in the loop by releasing refs here

      while (baseLineNumPosition < baseLineNums.length-1 && i >= baseLineNums[baseLineNumPosition+1][0]) {
        baseLineNumPosition++;
      }

      if (mainPass && (line[0] == '%' || line[0] == '@')) {
        // If this isn't a type, it's a global variable, make a note of the information now, we will need it later
        var parts = line.split(' = ');
        assert(parts.length >= 2);
        var left = parts[0], right = parts.slice(1).join(' = ');
        var testType = /^type .*/.exec(right);
        if (!testType) {
          var globalIdent = toNiceIdent(left);
          var testAlias = /^(hidden )?alias .*/.exec(right);
          Variables.globals[globalIdent] = {
            name: globalIdent,
            alias: !!testAlias,
            impl: VAR_EMULATED
          };
          unparsedGlobals.lines.push(line);
        } else {
          unparsedTypes.lines.push(line);
        }
        continue;
      }
      if (mainPass && /^define .*/.test(line)) {
        inFunction = true;
        currFunctionLines = [];
        currFunctionLineNum = i + 1;
      }
      if (!inFunction || !mainPass) {
        if (inContinual || /^\ +(to|catch |filter |cleanup).*/.test(line)) {
          // to after invoke or landingpad second line
          ret.slice(-1)[0].lineText += line;
          if (/^\ +\]/.test(line)) { // end of llvm switch
            inContinual = false;
          }
        } else {
          ret.push({
            lineText: line,
            lineNum: i + 1 + baseLineNums[baseLineNumPosition][1] - baseLineNums[baseLineNumPosition][0]
          });
          if (/^\ +switch\ .*/.test(line)) {
            // beginning of llvm switch
            inContinual = true;
          }
        }
      } else {
        currFunctionLines.push(line);
      }
      if (mainPass && /^}.*/.test(line)) {
        inFunction = false;
        if (mainPass) {
          var func = funcHeaderHandler(tokenizer({ lineText: currFunctionLines[0], lineNum: currFunctionLineNum }, true));

          if (SKIP_STACK_IN_SMALL && /emscripten_autodebug/.exec(func.ident)) {
            warnOnce('Disabling SKIP_STACK_IN_SMALL because we are apparently processing autodebugger data');
            SKIP_STACK_IN_SMALL = 0;
          }

          var ident = toNiceIdent(func.ident);
          if (!(ident in DEAD_FUNCTIONS)) {
            finalResults.push({
              intertype: 'unparsedFunction',
              // We need this early, to know basic function info - ident, params, varargs
              ident: ident,
              params: func.params,
              returnType: func.returnType,
              hasVarArgs: func.hasVarArgs,
              lineNum: currFunctionLineNum,
              lines: currFunctionLines
            });
          }
          currFunctionLines = [];
        }
      }
    }
    // We need lines beginning with ';' inside functions, because older LLVM versions generated labels that way. But when not
    // parsing functions, we can ignore all such lines and save some time that way.
    return ret.filter(function(item) { return item.lineText && (item.lineText[0] != ';' || !mainPass); });
  }

  function triager(item) {
    assert(!item.intertype);
    if (item.indent == 2 && (eq = findTokenText(item, '=')) >= 0) {
      item.assignTo = toNiceIdent(combineTokens(item.tokens.slice(0, eq)).text);
      item.tokens = item.tokens.slice(eq+1);
    }
    var token0Text = item.tokens[0].text;
    var token1Text = item.tokens[1] ? item.tokens[1].text : null;
    var tokensLength = item.tokens.length;
    if (item.indent === 2) {
      if (tokensLength >= 5 &&
          (token0Text == 'store' || token1Text == 'store'))
        return storeHandler(item);
      if (tokensLength >= 3 && token0Text == 'br')
        return branchHandler(item);
      if (tokensLength >= 2 && token0Text == 'ret')
        return returnHandler(item);
      if (tokensLength >= 2 && token0Text == 'switch')
        return switchHandler(item);
      if (token0Text == 'unreachable')
        return unreachableHandler(item);
      if (tokensLength >= 3 && token0Text == 'indirectbr')
        return indirectBrHandler(item);
      if (tokensLength >= 2 && token0Text == 'resume')
        return resumeHandler(item);
      if (tokensLength >= 3 &&
          (token0Text == 'load' || token1Text == 'load'))
        return loadHandler(item);
      if (tokensLength >= 3 &&
          token0Text in MATHOPS)
        return mathopsHandler(item);
      if (tokensLength >= 3 && token0Text == 'bitcast')
        return bitcastHandler(item);
      if (tokensLength >= 3 && token0Text == 'getelementptr')
        return GEPHandler(item);
      if (tokensLength >= 2 && token0Text == 'alloca')
        return allocaHandler(item);
      if (tokensLength >= 3 && token0Text == 'extractvalue')
        return extractValueHandler(item);
      if (tokensLength >= 3 && token0Text == 'insertvalue')
        return insertValueHandler(item);
      if (tokensLength >= 3 && token0Text == 'phi')
        return phiHandler(item);
      if (tokensLength >= 3 && token0Text == 'va_arg')
        return va_argHandler(item);
      if (tokensLength >= 3 && token0Text == 'landingpad')
        return landingpadHandler(item);
      if (token0Text == 'fence')
        return null;
    } else if (item.indent === 0) {
      if ((tokensLength >= 1 && token0Text.substr(-1) == ':') ||
          (tokensLength >= 3 && token1Text == '<label>') ||
          (tokensLength >= 2 && token1Text == ':'))
        return labelHandler(item);
      if (tokensLength >= 4 && token0Text == 'declare')
        return externalHandler(item);
      if (tokensLength >= 3 && token1Text == '=')
        return globalHandler(item);
      if (tokensLength >= 4 && token0Text == 'define' &&
         item.tokens.slice(-1)[0].text == '{')
        return funcHeaderHandler(item);
      if (tokensLength >= 1 && token0Text == '}')
        return funcEndHandler(item);
      if (token0Text == 'module' && token1Text == 'asm') {
        warn('Ignoring module asm: ' + item.tokens[2].text);
        return null;
      }
      if (token0Text == 'attributes')
        return null;
    }
    if (tokensLength >= 3 && (token0Text == 'call' || token1Text == 'call'))
      return callHandler(item);
    if (token0Text == 'target') {
      if (token1Text == 'triple') {
        var triple = item.tokens[3].text;
        triple = triple.substr(1, triple.length-2);
        var expected = TARGET_LE32 ? 'le32-unknown-nacl' : 'i386-pc-linux-gnu';
        if (triple !== expected) {
          warn('using an unexpected LLVM triple: ' + [triple, ' !== ', expected] + ' (are you using emcc for everything and not clang?)');
        }
      }
      return null;
    }
    if (token0Text == ';')
      return null;
    if (tokensLength >= 3 && token0Text == 'invoke')
      return invokeHandler(item);
    if (tokensLength >= 3 && token0Text == 'atomicrmw' || token0Text == 'cmpxchg')
      return atomicHandler(item);
    throw 'Invalid token, cannot triage: ' + dump(item);
  }

  // Line parsers to intermediate form

  // globals: type or variable
  function globalHandler(item) {
    function scanConst(value, type) {
      // Gets an array of constant items, separated by ',' tokens
      function handleSegments(tokens) {
        // Handle a single segment (after comma separation)
        function handleSegment(segment) {
          if (segment[1].text == 'null') {
            return { intertype: 'value', ident: '0', type: 'i32' };
          } else if (segment[1].text == 'zeroinitializer') {
            Types.needAnalysis[segment[0].text] = 0;
            return { intertype: 'emptystruct', type: segment[0].text };
          } else if (segment[1].text in PARSABLE_LLVM_FUNCTIONS) {
            return parseLLVMFunctionCall(segment);
          } else if (segment[1].type && segment[1].type == '{') {
            Types.needAnalysis[segment[0].text] = 0;
            return { intertype: 'struct', type: segment[0].text, contents: handleSegments(segment[1].tokens) };
          } else if (segment[1].type && segment[1].type == '<') {
            Types.needAnalysis[segment[0].text] = 0;
            return { intertype: 'struct', type: segment[0].text, contents: handleSegments(segment[1].item.tokens[0].tokens) };
          } else if (segment[1].type && segment[1].type == '[') {
            Types.needAnalysis[segment[0].text] = 0;
            return { intertype: 'list', type: segment[0].text, contents: handleSegments(segment[1].item.tokens) };
          } else if (segment.length == 2) {
            Types.needAnalysis[segment[0].text] = 0;
            return { intertype: 'value', type: segment[0].text, ident: toNiceIdent(segment[1].text) };
          } else if (segment[1].text === 'c') {
            // string
            var text = segment[2].text;
            text = text.substr(1, text.length-2);
            return { intertype: 'string', text: text, type: 'i8*' };
          } else if (segment[1].text === 'blockaddress') {
            return parseBlockAddress(segment);
          } else {
            throw 'Invalid segment: ' + dump(segment);
          }
        };
        return splitTokenList(tokens).map(handleSegment);
      }

      Types.needAnalysis[type] = 0;
      if (Runtime.isNumberType(type) || pointingLevels(type) >= 1) {
        return { value: toNiceIdent(value.text), type: type };
      } else if (value.text in ZEROINIT_UNDEF) { // undef doesn't really need initting, but why not
        return { intertype: 'emptystruct', type: type };
      } else if (value.text && value.text[0] == '"') {
        return { intertype: 'string', text: value.text.substr(1, value.text.length-2) };
      } else {
        if (value.type == '<') { // <{ i8 }> etc.
          value = value.item.tokens;
        }
        var contents;
        if (value.item) {
          // list of items
          contents = value.item.tokens;
        } else if (value.type == '{') {
          // struct
          contents = value.tokens;
        } else if (value[0]) {
          contents = value[0];
        } else {
          throw '// interfailzzzzzzzzzzzzzz ' + dump(value.item) + ' ::: ' + dump(value);
        }
        return { intertype: 'segments', contents: handleSegments(contents) };
      }
    }

    cleanOutTokens(LLVM.VISIBILITIES, item.tokens, 2);
    if (item.tokens[2].text == 'alias') {
      cleanOutTokens(LLVM.LINKAGES, item.tokens, 3);
      cleanOutTokens(LLVM.VISIBILITIES, item.tokens, 3);
      var last = getTokenIndexByText(item.tokens, ';');
      var ret = {
        intertype: 'alias',
        ident: toNiceIdent(item.tokens[0].text),
        value: parseLLVMSegment(item.tokens.slice(3, last)),
        lineNum: item.lineNum
      };
      ret.type = ret.value.type;
      Types.needAnalysis[ret.type] = 0;
      if (!NAMED_GLOBALS) {
        Variables.globals[ret.ident].type = ret.type;
      }
      return ret;
    }
    if (item.tokens[2].text == 'type') {
      var fields = [];
      var packed = false;
      if (Runtime.isNumberType(item.tokens[3].text)) {
        // Clang sometimes has |= i32| instead of |= { i32 }|
        fields = [item.tokens[3].text];
      } else if (item.tokens[3].text != 'opaque') {
        if (item.tokens[3].type == '<') {
          packed = true;
          item.tokens[3] = item.tokens[3].item.tokens[0];
        }
        var subTokens = item.tokens[3].tokens;
        if (subTokens) {
          subTokens.push({text:','});
          while (subTokens[0]) {
            var stop = 1;
            while ([','].indexOf(subTokens[stop].text) == -1) stop ++;
            fields.push(combineTokens(subTokens.slice(0, stop)).text);
            subTokens.splice(0, stop+1);
          }
        }
      }
      return {
        intertype: 'type',
        name_: item.tokens[0].text,
        fields: fields,
        packed: packed,
        lineNum: item.lineNum
      };
    } else {
      // variable
      var ident = item.tokens[0].text;
      var private_ = findTokenText(item, 'private') >= 0 || findTokenText(item, 'internal') >= 0;
      var named = findTokenText(item, 'unnamed_addr') < 0;
      cleanOutTokens(LLVM.GLOBAL_MODIFIERS, item.tokens, [2, 3]);
      var external = false;
      if (item.tokens[2].text === 'external') {
        external = true;
        item.tokens.splice(2, 1);
      }
      Types.needAnalysis[item.tokens[2].text] = 0;
      var ret = {
        intertype: 'globalVariable',
        ident: toNiceIdent(ident),
        type: item.tokens[2].text,
        external: external,
        private_: private_,
        named: named,
        lineNum: item.lineNum
      };
      if (!NAMED_GLOBALS) {
        Variables.globals[ret.ident].type = ret.type;
        Variables.globals[ret.ident].external = external;
      }
      Types.needAnalysis[ret.type] = 0;
      if (ident == '@llvm.global_ctors') {
        ret.ctors = [];
        if (item.tokens[3].item) {
          var subTokens = item.tokens[3].item.tokens;
          splitTokenList(subTokens).forEach(function(segment) {
            var ctor = toNiceIdent(segment[1].tokens.slice(-1)[0].text);
            ret.ctors.push(ctor);
            if (ASM_JS) { // must export the global constructors from asm.js module, so mark as implemented and exported
              Functions.implementedFunctions[ctor] = 'v';
              EXPORTED_FUNCTIONS[ctor] = 1;
            }
          });
        }
      } else if (!external) {
        if (item.tokens[3] && item.tokens[3].text != ';') {
          if (item.tokens[3].text == 'c') {
            item.tokens.splice(3, 1);
          }
          if (item.tokens[3].text in PARSABLE_LLVM_FUNCTIONS) {
            ret.value = parseLLVMFunctionCall(item.tokens.slice(2));
          } else {
            ret.value = scanConst(item.tokens[3], ret.type);
          }
        } else {
          ret.value = { intertype: 'value', ident: '0', value: '0', type: ret.type };
        }
      }
      return ret;
    }
  }
  // function header
  function funcHeaderHandler(item) {
    item.tokens = item.tokens.filter(function(token) {
      return !(token.text in LLVM.LINKAGES || token.text in LLVM.PARAM_ATTR || token.text in LLVM.FUNC_ATTR || token.text in LLVM.CALLING_CONVENTIONS);
    });
    var params = parseParamTokens(item.tokens[2].item.tokens);
    if (sidePass) dprint('unparsedFunctions', 'Processing function: ' + item.tokens[1].text);
    return {
      intertype: 'function',
      ident: toNiceIdent(item.tokens[1].text),
      returnType: item.tokens[0].text,
      params: params,
      hasVarArgs: hasVarArgs(params),
      lineNum: item.lineNum,
    };
  }
  // label
  function labelHandler(item) {
    var rawLabel = item.tokens[0].text.substr(-1) == ':' ?
          '%' + item.tokens[0].text.substr(0, item.tokens[0].text.length-1) :
          (item.tokens[1].text == '<label>' ?
           '%' + item.tokens[2].text.substr(1) :
           '%' + item.tokens[0].text)
    var niceLabel = toNiceIdent(rawLabel);
    return {
      intertype: 'label',
      ident: niceLabel,
      lineNum: item.lineNum
    };
  }

  // 'load'
  function loadHandler(item) {
    item.intertype = 'load';
    cleanOutTokens(LLVM.ACCESS_OPTIONS, item.tokens, [0, 1]);
    item.pointerType = item.tokens[1].text;
    item.valueType = item.type = removePointing(item.pointerType);
    Types.needAnalysis[item.type] = 0;
    var last = getTokenIndexByText(item.tokens, ';');
    var segments = splitTokenList(item.tokens.slice(1, last));
    item.pointer = parseLLVMSegment(segments[0]);
    if (segments.length > 1) {
      assert(segments[1][0].text == 'align');
      item.align = parseInt(segments[1][1].text) || QUANTUM_SIZE; // 0 means preferred arch align
    } else {
      item.align = QUANTUM_SIZE;
    }
    item.ident = item.pointer.ident || null;
    return item;
  }
  // 'extractvalue'
  function extractValueHandler(item) {
    var last = getTokenIndexByText(item.tokens, ';');
    item.intertype = 'extractvalue';
    item.type = item.tokens[1].text; // Of the origin aggregate - not what we extract from it. For that, can only infer it later
    Types.needAnalysis[item.type] = 0;
    item.ident = toNiceIdent(item.tokens[2].text);
    item.indexes = splitTokenList(item.tokens.slice(4, last));
    return item;
  }
  // 'insertvalue'
  function insertValueHandler(item) {
    var last = getTokenIndexByText(item.tokens, ';');
    item.intertype = 'insertvalue';
    item.type = item.tokens[1].text; // Of the origin aggregate, as well as the result
    Types.needAnalysis[item.type] = 0;
    item.ident = toNiceIdent(item.tokens[2].text);
    var segments = splitTokenList(item.tokens.slice(4, last));
    item.value = parseLLVMSegment(segments[0]);
    item.indexes = segments.slice(1);
    return item;
  }
  // 'bitcast'
  function bitcastHandler(item) {
    item.intertype = 'bitcast';
    item.type = item.tokens[4].text; // The final type
    Types.needAnalysis[item.type] = 0;
    var to = getTokenIndexByText(item.tokens, 'to');
    item.params = [parseLLVMSegment(item.tokens.slice(1, to))];
    item.ident = item.params[0].ident;
    item.type2 = item.tokens[1].text; // The original type
    Types.needAnalysis[item.type2] = 0;
    return item;
  }
  // 'getelementptr'
  function GEPHandler(item) {
    var first = 0;
    while (!isType(item.tokens[first].text)) first++;
    Types.needAnalysis[item.tokens[first].text] = 0;
    var last = getTokenIndexByText(item.tokens, ';');
    var segment = [ item.tokens[first], { text: 'getelementptr' }, null, { item: {
      tokens: item.tokens.slice(first, last)
    } } ];
    var data = parseLLVMFunctionCall(segment);
    item.intertype = 'getelementptr';
    item.type = '*'; // We need type info to determine this - all we know is it's a pointer
    item.params = data.params;
    item.ident = data.ident;
    return item;
  }
  // 'call', 'invoke'
  function makeCall(item, type) {
    item.intertype = type;
    if (['tail'].indexOf(item.tokens[0].text) != -1) {
      item.tokens.splice(0, 1);
    }
    while (item.tokens[1].text in LLVM.PARAM_ATTR || item.tokens[1].text in LLVM.CALLING_CONVENTIONS) {
      item.tokens.splice(1, 1);
    }
    item.type = item.tokens[1].text;
    Types.needAnalysis[item.type] = 0;
    while (['@', '%'].indexOf(item.tokens[2].text[0]) == -1 && !(item.tokens[2].text in PARSABLE_LLVM_FUNCTIONS) &&
           item.tokens[2].text != 'null' && item.tokens[2].text != 'asm' && item.tokens[2].text != 'undef') {
      assert(item.tokens[2].text != 'asm', 'Inline assembly cannot be compiled to JavaScript!');
      item.tokens.splice(2, 1);
    }
    var tokensLeft = item.tokens.slice(2);
    item.ident = eatLLVMIdent(tokensLeft);
    if (item.ident == 'asm') {
      if (ASM_JS) {
        Types.hasInlineJS = true;
        warnOnce('inline JavaScript (asm, EM_ASM) will cause the code to no longer fall in the asm.js subset of JavaScript, which can reduce performance - consider using emscripten_run_script');
      }
      assert(TARGET_LE32, 'inline js is only supported in le32');
      // Inline assembly is just JavaScript that we paste into the code
      item.intertype = 'value';
      if (tokensLeft[0].text == 'sideeffect') tokensLeft.splice(0, 1);
      item.ident = tokensLeft[0].text.substr(1, tokensLeft[0].text.length-2) || ';'; // use ; for empty inline assembly
      assert((item.tokens[5].text.match(/=/g) || []).length <= 1, 'we only support at most 1 exported variable from inline js: ' + item.ident);
      var i = 0;
      var params = [], args = [];
      splitTokenList(tokensLeft[3].item.tokens).map(function(element) {
        var ident = toNiceIdent(element[1].text);
        var type = element[0].text;
        params.push('$' + (i++));
        args.push(ident);
      });
      if (item.assignTo) item.ident = 'return ' + item.ident;
      item.ident = '(function(' + params + ') { ' + item.ident + ' })(' + args + ');';
      return { forward: null, ret: item, item: item };
    } 
    if (item.ident.substr(-2) == '()') {
      // See comment in isStructType()
      item.ident = item.ident.substr(0, item.ident.length-2);
      // Also, we remove some spaces which might occur.
      while (item.ident[item.ident.length-1] == ' ') {
        item.ident = item.ident.substr(0, item.ident.length-1);
      }
      item.params = [];
    } else {
      item.params = parseParamTokens(tokensLeft[0].item.tokens);
    }
    item.ident = toNiceIdent(item.ident);
    if (type === 'invoke') {
      var toIndex = findTokenText(item, 'to');
      item.toLabel = toNiceIdent(item.tokens[toIndex+2].text);
      item.unwindLabel = toNiceIdent(item.tokens[toIndex+5].text);
      assert(item.toLabel && item.unwindLabel);
    }
    if (item.indent == 2) {
      // standalone call - not in assign
      item.standalone = true;
      return { forward: null, ret: item, item: item };
    }
    return { forward: item, ret: null, item: item };
  }
  function callHandler(item) {
    var result = makeCall.call(this, item, 'call');
    if (result.forward) this.forwardItem(result.forward, 'Reintegrator');
    return result.ret;
  }
  function invokeHandler(item) {
    var result = makeCall.call(this, item, 'invoke');
    if (DISABLE_EXCEPTION_CATCHING == 1) {
      result.item.intertype = 'call';
      finalResults.push({
        intertype: 'branch',
        label: result.item.toLabel,
        lineNum: (result.forward ? item.parentLineNum : item.lineNum) + 0.5
      });
    }
    if (result.forward) this.forwardItem(result.forward, 'Reintegrator');
    return result.ret;
  }
  function atomicHandler(item) {
    item.intertype = 'atomic';
    if (item.tokens[0].text == 'atomicrmw') {
      if (item.tokens[1].text == 'volatile') item.tokens.splice(1, 1);
      item.op = item.tokens[1].text;
      item.tokens.splice(1, 1);
    } else {
      assert(item.tokens[0].text == 'cmpxchg')
      if (item.tokens[1].text == 'volatile') item.tokens.splice(1, 1);
      item.op = 'cmpxchg';
    }
    var last = getTokenIndexByText(item.tokens, ';');
    item.params = splitTokenList(item.tokens.slice(1, last)).map(parseLLVMSegment);
    item.type = item.params[1].type;
    return item;
  }
  // 'landingpad'
  function landingpadHandler(item) {
    item.intertype = 'landingpad';
    item.type = item.tokens[1].text;
    item.catchables = [];
    var catchIdx = findTokenText(item, "catch");
    if (catchIdx != -1) {
      do {
        var nextCatchIdx = findTokenTextAfter(item, "catch", catchIdx+1);
        if (nextCatchIdx == -1)
          nextCatchIdx = item.tokens.length;
        item.catchables.push(parseLLVMSegment(item.tokens.slice(catchIdx+2, nextCatchIdx)));
        catchIdx = nextCatchIdx;
      } while (catchIdx != item.tokens.length);
    }
    Types.needAnalysis[item.type] = 0;
    return item;
  }
  // 'alloca'
  var allocaPossibleVars = ['allocatedNum'];
  function allocaHandler(item) {
    item.intertype = 'alloca';
    item.allocatedType = item.tokens[1].text;
    if (item.tokens.length > 3 && Runtime.isNumberType(item.tokens[3].text)) {
      item.allocatedNum = toNiceIdent(item.tokens[4].text);
      item.possibleVars = allocaPossibleVars;
    } else {
      item.allocatedNum = 1;
    }
    item.type = addPointing(item.tokens[1].text); // type of pointer we will get
    Types.needAnalysis[item.type] = 0;
    item.type2 = item.tokens[1].text; // value we will create, and get a pointer to
    Types.needAnalysis[item.type2] = 0;
    return item;
  }
  // 'phi'
  function phiHandler(item) {
    item.intertype = 'phi';
    item.type = item.tokens[1].text;
    var typeToken = [item.tokens[1]];
    Types.needAnalysis[item.type] = 0;
    var last = getTokenIndexByText(item.tokens, ';');
    item.params = splitTokenList(item.tokens.slice(2, last)).map(function(segment) {
      var subSegments = splitTokenList(segment[0].item.tokens);
      var ret = {
        intertype: 'phiparam',
        label: toNiceIdent(subSegments[1][0].text),
        value: parseLLVMSegment(typeToken.concat(subSegments[0]))
      };
      return ret;
    }).filter(function(param) { return param.value && param.value.ident != 'undef' });
    return item;
  }
  // 'phi'
  function va_argHandler(item) {
    item.intertype = 'va_arg';
    var segments = splitTokenList(item.tokens.slice(1));
    item.type = segments[1][0].text;
    item.value = parseLLVMSegment(segments[0]);
    return item;
  }
  // mathops
  function mathopsHandler(item) {
    item.intertype = 'mathop';
    item.op = item.tokens[0].text;
    item.variant = null;
    while (item.tokens[1].text in NSW_NUW) item.tokens.splice(1, 1);
    if (['icmp', 'fcmp'].indexOf(item.op) != -1) {
      item.variant = item.tokens[1].text;
      item.tokens.splice(1, 1);
    }
    if (item.tokens[1].text == 'exact') item.tokens.splice(1, 1); // TODO: Implement trap values
    var segments = splitTokenList(item.tokens.slice(1));
    item.params = [];
    for (var i = 1; i <= 4; i++) {
      if (segments[i-1]) {
        if (i > 1 && segments[i-1].length == 1 && segments[0].length > 1 && !isType(segments[i-1][0].text)) {
          segments[i-1].unshift(segments[0][0]); // Add the type from the first segment, they are all alike
        }
        item.params[i-1] = parseLLVMSegment(segments[i-1]);
      }
    }
    var setParamTypes = true;
    if (item.op === 'select') {
      assert(item.params[1].type === item.params[2].type);
      item.type = item.params[1].type;
    } else if (item.op in LLVM.CONVERSIONS) {
      item.type = item.params[1].type;
      setParamTypes = false;
    } else {
      item.type = item.params[0].type;
    }
    if (setParamTypes) {
      for (var i = 0; i < 4; i++) {
        if (item.params[i]) item.params[i].type = item.type; // All params have the same type, normally
      }
    }
    if (item.op in LLVM.EXTENDS) {
      item.type = item.params[1].ident;
      item.params[0].type = item.params[1].type;
      // TODO: also remove 2nd param?
    } else if (item.op in LLVM.COMPS) {
      item.type = 'i1';
    }
    if (USE_TYPED_ARRAYS == 2) {
      // Some specific corrections, since 'i64' is special
      if (item.op in LLVM.SHIFTS) {
        item.params[1].type = 'i32';
      } else if (item.op == 'select') {
        item.params[0].type = 'i1';
      }
    }
    Types.needAnalysis[item.type] = 0;
    return item;
  }
  // 'store'
  function storeHandler(item) {
    cleanOutTokens(LLVM.ACCESS_OPTIONS, item.tokens, [0, 1]);
    var segments = splitTokenList(item.tokens.slice(1));
    var ret = {
      intertype: 'store',
      valueType: item.tokens[1].text,
      value: parseLLVMSegment(segments[0]),
      pointer: parseLLVMSegment(segments[1]),
      lineNum: item.lineNum
    };
    Types.needAnalysis[ret.valueType] = 0;
    ret.ident = toNiceIdent(ret.pointer.ident);
    ret.pointerType = ret.pointer.type;
    Types.needAnalysis[ret.pointerType] = 0;
    if (segments.length > 2) {
      assert(segments[2][0].text == 'align');
      ret.align = parseInt(segments[2][1].text) || QUANTUM_SIZE; // 0 means preferred arch align
    } else {
      ret.align = QUANTUM_SIZE;
    }
    return ret;
  }
  // 'br'
  function branchHandler(item) {
    if (item.tokens[1].text == 'label') {
      return {
        intertype: 'branch',
        label: toNiceIdent(item.tokens[2].text),
        lineNum: item.lineNum
      };
    } else {
      var commaIndex = findTokenText(item, ',');
      return {
        intertype: 'branch',
        value: parseLLVMSegment(item.tokens.slice(1, commaIndex)),
        labelTrue: toNiceIdent(item.tokens[commaIndex+2].text),
        labelFalse: toNiceIdent(item.tokens[commaIndex+5].text),
        lineNum: item.lineNum
      };
    }
  }
  // 'ret'
  function returnHandler(item) {
    var type = item.tokens[1].text;
    Types.needAnalysis[type] = 0;
    return {
      intertype: 'return',
      type: type,
      value: (item.tokens[2] && type !== 'void') ? parseLLVMSegment(item.tokens.slice(1)) : null,
      lineNum: item.lineNum
    };
  }
  // 'resume' - partial implementation
  function resumeHandler(item) {
    return {
      intertype: 'resume',
      ident: toNiceIdent(item.tokens[2].text),
      lineNum: item.lineNum
    };
  }
  // 'switch'
  function switchHandler(item) {
    function parseSwitchLabels(item) {
      var ret = [];
      var tokens = item.item.tokens;
      while (tokens.length > 0) {
        ret.push({
          value: tokens[1].text,
          label: toNiceIdent(tokens[4].text)
        });
        tokens = tokens.slice(5);
      }
      return ret;
    }
    var type = item.tokens[1].text;
    Types.needAnalysis[type] = 0;
    return {
      intertype: 'switch',
      type: type,
      ident: toNiceIdent(item.tokens[2].text),
      defaultLabel: toNiceIdent(item.tokens[5].text),
      switchLabels: parseSwitchLabels(item.tokens[6]),
      lineNum: item.lineNum
    };
  }
  // function end
  function funcEndHandler(item) {
    return {
      intertype: 'functionEnd',
      lineNum: item.lineNum
    };
  }
  // external function stub
  function externalHandler(item) {
    while (item.tokens[1].text in LLVM.LINKAGES || item.tokens[1].text in LLVM.PARAM_ATTR || item.tokens[1].text in LLVM.VISIBILITIES || item.tokens[1].text in LLVM.CALLING_CONVENTIONS) {
      item.tokens.splice(1, 1);
    }
    var params = parseParamTokens(item.tokens[3].item.tokens);
    return {
      intertype: 'functionStub',
      ident: toNiceIdent(item.tokens[2].text),
      returnType: item.tokens[1],
      params: params,
      hasVarArgs: hasVarArgs(params),
      lineNum: item.lineNum
    };
  }
  // 'unreachable'
  function unreachableHandler(item) {
    return {
      intertype: 'unreachable',
      lineNum: item.lineNum
    };
  }
  // 'indirectbr'
  function indirectBrHandler(item) {
    var ret = {
      intertype: 'indirectbr',
      value: parseLLVMSegment(splitTokenList(item.tokens.slice(1))[0]),
      type: item.tokens[1].text,
      lineNum: item.lineNum
    };
    Types.needAnalysis[ret.type] = 0;
    return ret;
  }

  // Input

  lineSplitter().forEach(function(line) {
    var t = tokenizer(line);
    var item = triager(t);
    if (!item) return;
    finalResults.push(item);
    if (item.tokens) item.tokens = null; // We do not need tokens, past the intertyper. Clean them up as soon as possible here.
  });
  return finalResults;
}

