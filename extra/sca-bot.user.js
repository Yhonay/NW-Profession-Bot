// ==UserScript==
// @name Neverwinter gateway - SCA Bot
// @description
// @namespace https://github.com/Yhonay/NW-Profession-Bot
// @include     http*://gateway.playneverwinter.com*
// @version     8
// @require     http://cdnjs.cloudflare.com/ajax/libs/lodash.js/2.4.1/lodash.js
// require     http://ajax.googleapis.com/ajax/libs/jquery/1.10.2/jquery.js
// require     http://cdnjs.cloudflare.com/ajax/libs/datatables/1.9.4/jquery.dataTables.js
// @grant       none
// @originalAuthor AnnanFay
// @modifiedBy Yhonay
// ==/UserScript==

/* globals $, unsafeWindow, _, client */
try {
  (function () {
    "strict true";
    var DEBUG = true;
    window.PAUSED = false;
    // unsafeWindow.localStorage.debug = '*';



    function str(f) {
      return f.toString()
        .replace(/^[^\/]+\/\*!?/, '')
        .replace(/\*\/[^\/]+$/, '');
    }

    function addCss(css) {
      $("<style type='text/css'></style>")
        .html(css)
        .appendTo("head");
    }
    var CSS = str(function () {
      /*!
          #reward-bag {
            padding: 0.5em;
            position: absolute;
            right: 0;
            top: 0;
            width: 20%;
            min-height: 100%;
            border: 1px solid white;
            background-color: #999;
            z-index: 100;
          }
          #reward-bag > div {
            height: 1em;
            overflow: hidden;
          }
          #reward-bag > div.open {
            height: auto;
            overflow: auto;
          }
    */
    });

    function max(a, b) {
      // safe max
      return Math.max(a || 0, b || 0);
    }

    var Vector = {
      dist: function (a, b) {
        var d = 0;
        var l = Math.max(a.length, b.length);
        for (var i = 0; i < l; i++) {
          d += Math.pow((a[i] || 0) - (b[i] || 0), 2);
        }
        return Math.sqrt(d);
      },
      length: function (vec) {
        var d = 0;
        for (var i = 0; i < vec.length; i++) {
          d += Math.pow((vec[i] || 0), 2);
        }
        return Math.sqrt(d);
      },
      norm: function (vec) {
        var d = Vector.length(vec);
        if (!d) return 0;
        var v = [];
        for (var i = 0; i < vec.length; i++) {
          v[i] = vec[i] / d;
        }
        return v;
      }
    };

    function debug() {
      if (DEBUG) {
        var l = arguments[0];
        var now = new Date();
        var dateString = now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds() + ' || V';
        Array.prototype.splice.call(arguments, 0, 0, dateString)
        console[(!l) ? 'error' : 'log'].apply(console, arguments);
      }
    }

    function getSortedKeys(obj) {
      var keys = []; for(var key in obj) keys.push(key);
      return keys.sort(function(a,b){return obj[b]-obj[a];});
    }

    // Decision making code
    function dieValue(trials, die) {
      var score = 0;
      var need = [];
      need.p = 0;
      need.t = 0;
      need.m = 0;
      need.c = 0;
      var rolled = [];
      rolled.p = 0;
      rolled.t = 0;
      rolled.m = 0;
      rolled.c = 0;

      _(trials).forEach(function (t) {
        _(t.needs).forEach(function (n) {
          need[n.symbol] += n.requires;
        });
      });

      for (var i = 0, len = die.roll.symbol.length; i < len; i++) {
        if(die.roll.symbol.charAt(i)==='w'){
          var order = { m: 0, p: 1, t: 2, c: 3 };
          //get real dragon worth for most needed
          rolled[getSortedKeys(need)[0]] = die.roll.vals[order[getSortedKeys(need)[0]]].count;
        }else{
          rolled[die.roll.symbol.charAt(i)] = (len>1 && die.roll.symbol.charAt(i)==c) ? 3 : die.roll.count; //make combat in multisides worth 3
        }
        //adjust score by locks taken out by die so we'll favor most effective die in case of a tie
        score -= ( Math.min(need.p, rolled.p) + Math.min(need.t, rolled.t) + Math.min(need.m, rolled.m) + (Math.min(need.c, rolled.c) / 3) ) / 100;
      }

      need.p = Math.max(0, (need.p - rolled.p));
      need.t = Math.max(0, (need.t - rolled.t));
      need.m = Math.max(0, (need.m - rolled.m));
      need.c = Math.max(0, (need.c - rolled.c));

      _(die.sides).forEach(function (side) {
        var symbol = side.sym === 'w' ? getSortedKeys(need)[0] : side.sym; //if wildcart calculate for most needed
        //wildcards can be worth 2 points but since we can not predict it, lets guestimate lowest posible outcome
        var count = side.sym === 'w' && getSortedKeys(need)[0] === 'c' ? 3 : side.count;
        for (var i = 0, len = symbol.length; i < len; i++) {
          if(need[symbol.charAt(i)]!==0){
            count = (len>1 && symbol.charAt(i)==c) ? 3 : count; //make combat in multisides worth 3
            score += Math.min(count, need[symbol.charAt(i)]) / need[symbol.charAt(i)];
          }
        }
      });
      return score / die.count;
    }

    function dieNeed(trials, die) {
      var needed = 1000;
      _(trials).forEach(function (t) {
        if(t.active===0) return; //continue
        _(t.needs).forEach(function (n) {
          if (die.symbol === n.symbol) {
            needed = n.requires;
          }
        });
      });
      return needed;
    }

    function validDice(dice, discarding) {
      //(!d.locked && (d.valid || discarding && !d.used))
      return _(dice)
        .reject('locked') // not accessible yet
        .reject('used') // already played
        .filter(discarding ? _.constant(true) : 'valid')
        .value();
    }

    // bit better than random
    function chooseDie(trials, allDice, discarding, canRoll) {
      var dice = validDice(allDice, discarding);

      //find best die of a type / discard others
      for(var i=0, len=dice.length; i<len;i++){
        if(dice.i===undefined) continue;
        for(var j=0, len2=dice.length; j<len2;j++){
          if(dice.j===undefined) continue;
          if(dice.i.color==dice.j.color && dice.i.roll.symbol==dice.j.roll.symbol){
            if(dice.i.roll.count<dice.j.roll.count) {
              dice.splice(dice.i.id);
            }
          }
        }
      }
      //end find best

      dice = _.forEach(dice, function (die) {
        die.value = dieValue(trials, die);
      });
      // use lowest value dice first
      dice = dice = _.sortBy(dice, 'value');
      if(((dice[0].color==="base" && dice[0].roll.symbol==="c" && dice[0].roll.count<3) ||
          (dice[0].color!=="base" && dice[0].roll.symbol==="c" && dice[0].roll.count<6) ||
          (dice[0].color!=="base" && dice[0].roll.symbol!=="c" && dice[0].roll.count<2)) &&
         canRoll===true && dice[0].roll.count<dieNeed(trials, dice[0].roll)) {
        return null;
      }
      return dice[0].id;
    }

    function combatChoice(client, discarding, canRoll) {
      var gd = client.dataModel.model.gatewaygamedata;
      var trials = gd.quest.encounter.challenge.trials;
      var allDice = gd.quest.roller.pile.dice;

      var die = chooseDie(trials, allDice, discarding, canRoll);
      if( die === null ) {
        client.scaRollDice();
        return;
      }

      var d = client.dataModel.model.gatewaygamedata.quest.roller.pile.dice[die];
      var e = $(".dice.slot-" + die);
      if (d.used || e.hasClass("used") || e.hasClass("disabled")) {
        debug(0, 'vbad1', d.used, e.hasClass("used"), e.hasClass("disabled"));
      }
      var state = client.dataModel.model.gatewaygamedata.state;

      if (state == "k_Discard" && d.valid || (state == "k_CombatChoose" || state == "k_Combat") && !d.valid) {
        debug(0, 'vbad2');
      }

      when(function () {
        var e = $(".dice.slot-" + die);
        var state = client.dataModel.model.gatewaygamedata.state;
        var d = client.dataModel.model.gatewaygamedata.quest.roller.pile.dice[die];
        return e.length //
          && !d.used //
          && !e.hasClass('used') //
          && !e.hasClass('disabled') //
          && !(state == "k_Discard" && d.valid) //
          && !((state == "k_CombatChoose" || state == "k_Combat") //
            && !d.valid);
      }, function () {
        var uiLink = $(".dice.slot-" + die);
        debug(1, 'COMBAT CHOICE', die, uiLink.offset(), uiLink);
        debug(1, 'CURRENT STATE', d, state);

        if(allDice[die].roll.symbol=='w'){
          var need = [];
          need.p = 0;
          need.t = 0;
          need.m = 0;
          need.c = 0;
          _(trials).forEach(function (t) {
            if(t.active===0) return; //continue
            _(t.needs).forEach(function (n) {
              need[n.symbol] += n.requires;
            });
          });
          var mostNeeded = getSortedKeys(need)[0];
          var uiLinkW = '';
          if(mostNeeded=='m') mostNeeded=0;
          if(mostNeeded=='p') mostNeeded=1;
          if(mostNeeded=='t') mostNeeded=2;
          if(mostNeeded=='c') mostNeeded=3;
          client.scaChooseDieWild(die, mostNeeded, uiLink.offset());
        }else{
          client.scaChooseDie(die, uiLink.offset());
        }
      });
    }

    function partyPowerVectors(party) {
      return _.map(party, function (m) {
        var powerVector = _(m.pow).mapValues('p').pairs().sortBy(0).map(1).value()
        return Vector.norm(powerVector);
      });
    }

    function encounterPowerVectors(encs) {
      return _.map(encs, function (enc) {
        var p = _(enc.challenge.trials)
          .map('needs')
          .reduce(function (acc, trial) {
            return _.merge(acc, trial, function (a, b) {
              return b.count + (a && a.count || 0);
            });
          }, {
            c: 0,
            m: 0,
            p: 0,
            t: 0
          });

        return _(p).pairs().sortBy(0).map(1).value();
      });
    }

    function encounterPowerCompares(party, encs, powers, encPowers) {
      var compares = [];
      for (var i in powers) {
        for (var j in encPowers) {
          compares.push({
            id: party[i].typename + ' - ' + encs[j].challenge.def.name,
            mem: party[i],
            enc: encs[j],
            score: Vector.dist(Vector.norm(powers[i]), Vector.norm(encPowers[j]))
          });
        }
      }
      return _.sortBy(compares, 'score');
    }

    function encounterChoice(client) {
      // get needed data
      var gamedata = client.dataModel.model.gatewaygamedata;
      var party = gamedata.party.members; // includes resting
      var encs = _(gamedata.quest.encs)
        .omit('end').reject('complete').reject({
          id: gamedata.quest.encs.end.id
        }).filter('challenge').value();

      var choice;
      debug(1, 'encs', encs);

      // deal with stars and boss battle
      if (!encs.length) {
        var encID = gamedata.quest.map.match(/data\-encounter\-id="([^"]+)" data\-tt\-stencil="content-tt-sca-descend"/);
        //could also use '.stairs-down'
        if (encID) {
          // stairs
          return {
            encounterID: encID[1],
            memberID: undefined
          };
        } else {
          // boss
          encs = [gamedata.quest.encs.end];
        }
      }

      // find hard encounters for good characters
      var powers = partyPowerVectors(party);
      var encPowers = encounterPowerVectors(encs);
      var compares = encounterPowerCompares(party, encs, powers, encPowers)

      for (var i in encs) {
        var enc = encs[i];
        var bestCompare = _(compares).filter({
          enc: enc
        }).sortBy('score').first();
        enc.best = bestCompare.mem.id;
        enc.bestResting = bestCompare.mem.resting;
        enc.score = bestCompare.score;
      }

      _(encs).sortBy('score').reverse().forEach(function (enc) {
        if (!enc.bestResting) {
          choice = {
            encounterID: enc.id,
            memberID: enc.best
          }
        }
      });

      // Find easy encounters for bad characters
      if (!choice) {
        var active = _.reject(party, 'resting');
        for (var i in active) {
          var mem = active[i];
          var bestCompare = _(compares).filter({
            mem: mem
          }).sortBy('score').first();
          mem.bestEnc = bestCompare.enc.id;
          mem.bestScore = bestCompare.score;
        }
        var bestMem = _(active).sortBy('bestScore').first();
        choice = {
          encounterID: bestMem.bestEnc,
          memberID: bestMem.id
        }
      }

      if (choice) {
        return choice;
      } else {
        debug(0, 'dunno what to do!');
      }
    }

    function shift(client, a, b) {
      // debug(1, 'SHIFTING... ', client.shifter.toSource())
      client.shifter.shift(client.shifter.resolveHash("/adventures/" + a),
        false, true, b);
    }

    function flog(i, f, args_) {
      var args = Array.prototype.slice.call(arguments, 2);
      debug(3, i, args);
      return f.apply(this, args);
    }

    function updateRewardBag() {
      var qid = client.dataModel.model.gatewaygamedata.quest.id;
      var bag = $('#reward-bag .quest-' + qid);
      if (!bag.length) {
        $('#reward-bag').append('<div class="quest-' + qid + '"><h2>' + qid + '</h2><div class="rewards"></div></div>');
        bag = $('#reward-bag .quest-' + qid);
      }

      $('#reward-bag div').removeClass('open');
      bag.addClass('open');

      var rewardBag = $('.rewards', bag).empty();
      var rewards = client.dataModel.model.gatewaygamedata.queuedrewardbag.rewards;
      for (var i in rewards) {
        var r = rewards[i];
        rewardBag.append('<div>' + r.count + 'x ' + r.name + ' (' + r.value + ')</div>');
      }
    }



    var encChoice = undefined;
    var eventHandlers = {
      k_ChooseQuest: function () {
        var level = 'd3';

        client.emitToProxy("Client_ScaSetQuest", {
          id: level
        });
        setTimeout(client.scaConfirmQuest, 1000);
        encChoice = undefined;
      },
      k_ChooseParty: function () {
        shift(client, 'chooseparty', function () {
          when(function () {
            var companions = client.dataModel.model.gatewaygamedata.companions;
            return !!_(companions).filter('valid').reject('selected').value().length;
          }, function () {
            var companions = client.dataModel.model.gatewaygamedata.companions;
            var choice = _(companions).filter('valid').reject('selected').sortBy('stamina').last();
            client.scaAddPartyMember(choice.id, undefined);
          });
        });
      },
      k_ConfirmTavernCompanions: function () {
        eventHandlers.k_ConfirmParty();
      },
      k_ConfirmParty: function () {
        client.scaConfirmParty();
      },
      k_FirstRolling: function () {
        shift(client, 'combat', function () {
          client.scaEnterCombat();
        });
      },
      k_Rolling: function () {
        shift(client, 'combat', function () {
          setTimeout(client.scaAnimateDiceRoll, 500);
        });
      },
      k_Combat: function () {
        eventHandlers.k_CombatChoose(false, true);
      },
      k_Discard: function () {
        eventHandlers.k_CombatChoose(true, false);
      },
      k_CombatChoose: function (discarding, canRoll) {
        //debug(1, 'k_CombatChoose', arguments);
        shift(client, 'combat', function () {
          combatChoice(client, discarding, canRoll);
          lastState = '';
        });
      },
      k_ChallengeFailure: function () {
        eventHandlers.k_ChallengeSuccess();
      },
      k_ChallengeSuccess: function () {
        updateRewardBag();
        client.scaCombatDone();
        encChoice = undefined;
      },
      k_ChooseEncounter: function () {
        // k_ChooseEncounter ->
        // scaSetEncounter ["r11c15", true] ->
        // k_ConfirmEncounter ->
        // scaConfirmEncounter ["2166553002146529548", "Pet_Dog"]
        var health = client.dataModel.model.gatewaygamedata.party.health;
        if (health < 2) {
          //throw new Error('quit now');
          client.scaQuestDone();
          return;
        }
        if (!encChoice) {
          encChoice = encounterChoice(client);
          debug(2, 'encChoice', encChoice);
          setTimeout(client.scaSetEncounter, 1000,
            encChoice.encounterID, true);
          if (!encChoice.memberID) {
            // not a real encounter
            encChoice = undefined;
          }
        }
      },
      k_ConfirmEncounter: function () {

        if (encChoice) {
          // setTimeout(function () {
          //   shift(client, 'explore', function () {
          //     shift(client, 'encounter', function () {
          // debug(2, 'CALL client.scaConfirmEncounter(', encChoice.memberID, undefined, ');')
          setTimeout(client.scaConfirmEncounter, 2000,
            encChoice.memberID, undefined);
          //     });
          //   });
          // }, 2000);
        } else {
          debug(2, 'cannot confirm');
          client.scaConfirmEncounter('');
          client.stopHelp();
          eventHandlers.k_ChooseEncounter();
        }
      },
      k_QuestSuccess: function () {
        client.scaQuestDone();
      },
      k_QuestFailure: function () {
        client.scaQuestDone();
      }
    };
    var lastState = '';

    function scaProcessStateWrapper(f) {
      lastAction = new Date();

      var args = Array.prototype.slice.call(arguments, 1);
      var state = args[0];
      var passing = PAUSED || !(state in eventHandlers) || window.location.href.indexOf('/adventures') == -1;

      debug(2, 'scaProcessState', args, 'passing: ', passing);

      if (passing) {
        return f.apply(this, args);
      }

      // if (lastState === state) {
      //   return;
      // }
      lastState = state;
      try {
        eventHandlers[state]();
      } catch (e) {
        debug(0, 'scaProcessStateWrapper error', e);
        return f.apply(this, args);
      }
    }

    function init() {
      // var $anim = jQuery.fn.animate;
      // jQuery.fn.animate = function () {
      //   debug(1, '$anim', this, arguments);
      //   return $anim.apply(this, arguments);
      // }

      // var $delay = jQuery.fn.delay;
      // jQuery.fn.delay = function () {
      //   debug(1, '$delay', this, arguments);
      //   return $delay.apply(this, arguments);
      // }

      lastAction = new Date();
      addCss(CSS);

      var client = window.client;
      debug(2, 'init, client:', client);

      var wrapped = [];

      for (var i in client) {
        var f = client[i];
        if (f && !f.__bindData__ && typeof f === 'function' && (i.indexOf('sca') === 0 || i == 'emitToProxy')) {
          wrapped.push(i);
          client[i] = _.wrap(f, _.partial(flog, i));
        }
      }

      //client.shifter.shift = _.wrap(client.shifter.shift, _.partial(flog, 'shifter.shift'));
      for (var i in client.shifter) {
        var f = client.shifter[i];
        if (f && !f.__bindData__ && typeof f === 'function') {
          wrapped.push(i);
          client.shifter[i] = _.wrap(f, _.partial(flog, 'shifter.' + i));
        }
      }

      debug(2, 'wrapped', wrapped);
      //setTimeout(function () {
        client.scaProcessState = _.wrap(client.scaProcessState, scaProcessStateWrapper);
      //}, 2000);

      var bag = $('<div id="sco-bot"><div id="stats"></div><div id="reward-bag"></div></div>')
        .appendTo(document.body);
    }

    function when(pred, f) {
      // KISS!
      try {
        var v = pred();
      } catch (e) {}
      v ? f() : setTimeout(when, 200, pred, f);
    }

    function scaIsLoaded() {
      return !!(window.client && window.client.scaProcessState);
    }

    var lastAction = new Date();

    function sleeping() {
      var dur = 60 * 1000 * 2; // 2min
      var diff = (new Date() - lastAction);
      return diff > dur && window.location.href.indexOf('adventures') != -1;
    }

    function reload() {
      window.location.reload(false);
    }

    when(scaIsLoaded, init);
    when(sleeping, reload);
  })();
} catch (e) {
  console.log('error:', e)
}
