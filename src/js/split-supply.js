/* ═════════════════════════════════════════════════════════════════════
   SPLIT SUPPLY ENGINE — Phase 7
   Tests ALL combinations:
     A. Standard split: Barge A → VLSFO, Barge B → MGO (different fuels)
     B. Partial MGO: Barge A → VLSFO + partial MGO, Barge B → remaining MGO
     C. Single-fuel split: Barge A + Barge B → VLSFO (large qty, both barges)
     D. Single-fuel split: Barge A + Barge B → MGO
     E. After-ops: barge has stock but is temporarily busy
   Returns the best split option or null if none viable.
   ═════════════════════════════════════════════════════════════════════ */
function _evaluateSplitSupply(bargeResults, vReq, mReq, requestedETA, travelHrs, hoseHrs, TOL) {
  var now = new Date();

  /* Pick the earliest available start for a barge doing a given qty/tph */
  function splitTiming(r, qty, tph) {
    var jobHrs  = hoseHrs + qty / (tph || 300);
    var tl      = r.timeline || [];
    if (tl.length === 0) {
      var eta = requestedETA || now;
      return { start: eta, etc: addHrs(eta, jobHrs), label: 'Free on arrival', free: true };
    }
    return _findEarliestStart(tl, r.freeFrom, requestedETA, jobHrs, travelHrs);
  }
  /* Earliest conflict-free start for a job of jobHrs on barge r, never
     before notBefore (used where the job must respect another barge's
     schedule too — berth occupancy, or an STS partner). */
  function timingForHrs(r, jobHrs, wantAt, notBefore) {
    var lb = new Date(Math.max(r.freeFrom ? r.freeFrom.getTime() : 0, notBefore ? notBefore.getTime() : 0, now.getTime()));
    return _findEarliestStart(r.timeline || [], lb, wantAt, jobHrs, travelHrs);
  }
  /* STS needs donor AND recipient free together; the recipient then stays
     busy straight through the vessel supply. Iterate until both agree. */
  function stsTiming(recipient, donor, stsJobHrs, supplyJobHrs) {
    // Ideally the transfer finishes just as the vessel arrives.
    var want = requestedETA ? new Date(Math.max(now.getTime(), requestedETA.getTime() - stsJobHrs * 3600000)) : now;
    var lb = want, start = want;
    for (var it = 0; it < 6; it++) {
      var tR = timingForHrs(recipient, stsJobHrs + supplyJobHrs, lb, lb);
      var tD = timingForHrs(donor, stsJobHrs, tR.start, tR.start);
      start = tR.start;
      if (tD.start.getTime() <= tR.start.getTime()) break;
      lb = tD.start; start = tD.start;
    }
    return start;
  }

  // Guard: Cases C/D below plan a SINGLE grade only. When both grades are
  // requested and A/B/fallback all failed, falling into them used to return
  // a VLSFO-only plan while the verdict said "feasible" — MGO silently
  // dropped. Never report a split that leaves a requested grade unplanned.

  /* ── Case A: Standard split — one barge per fuel ── */
  if (vReq > 0 && mReq > 0) {
    var vBarges = bargeResults.filter(function (r) { return r.availRv >= vReq; });
    var mBarges = bargeResults.filter(function (r) { return r.availRm >= mReq; });

    for (var vi = 0; vi < vBarges.length; vi++) {
      for (var mi = 0; mi < mBarges.length; mi++) {
        if (vBarges[vi].b.id === mBarges[mi].b.id) continue; // must be different barges
        var vT = splitTiming(vBarges[vi], vReq, vBarges[vi].b.vtph || 300);
        var mT = splitTiming(mBarges[mi], mReq, mBarges[mi].b.mtph || 100);
        // Phase 8: Berth occupancy — one barge at a time
        var firstIsV  = vT.start <= mT.start;
        var first     = firstIsV ? vT : mT;
        var firstR    = firstIsV ? vBarges[vi] : mBarges[mi];
        var firstFuel = firstIsV ? 'VLSFO' : 'MGO';
        var firstQty  = firstIsV ? vReq : mReq;
        var firstTph  = firstIsV ? (vBarges[vi].b.vtph || 300) : (mBarges[mi].b.mtph || 100);
        var second    = firstIsV ? mT : vT;
        var secondR   = firstIsV ? mBarges[mi] : vBarges[vi];
        var secondFuel= firstIsV ? 'MGO' : 'VLSFO';
        var secondQty = firstIsV ? mReq : vReq;
        var secondTph = firstIsV ? (mBarges[mi].b.mtph || 100) : (vBarges[vi].b.vtph || 300);

        var firstJobHrs   = hoseHrs + firstQty / firstTph;
        var firstEtc      = addHrs(first.start, firstJobHrs);
        var firstDepart   = addHrs(firstEtc, travelHrs);
        var secondStart   = new Date(Math.max(second.start.getTime(), firstDepart.getTime()));
        var secondJobHrs  = hoseHrs + secondQty / secondTph;
        var secondEtc     = addHrs(secondStart, secondJobHrs);
        var overallEtc    = secondEtc;
        var secondDelayed = secondStart > second.start;

        return {
          type: 'standard',
          vBarge: vBarges[vi], mBarge: mBarges[mi],
          firstR: firstR, secondR: secondR,
          firstFuel: firstFuel, secondFuel: secondFuel,
          firstQty: firstQty, secondQty: secondQty,
          firstTph: firstTph, secondTph: secondTph,
          first: first, second: second,
          firstStart: first.start, firstEtc: firstEtc, firstDepart: firstDepart,
          secondStart: secondStart, secondEtc: secondEtc, overallEtc: overallEtc,
          secondDelayed: secondDelayed,
          secondDelayHrs: secondDelayed ? (secondStart - second.start) / 3600000 : 0,
          berthOk: true,
          summary: firstR.b.name + ' (' + firstFuel + ') + ' + secondR.b.name + ' (' + secondFuel + ')',
          plan: firstR.b.name + ' alongside ' + fmt24(first.start) + '→' + fmt24(firstEtc) + ' (' + firstFuel + ' ' + firstQty.toLocaleString() + ' MT). ' +
                secondR.b.name + ' alongside ' + fmt24(secondStart) + '→' + fmt24(secondEtc) + ' (' + secondFuel + ' ' + secondQty.toLocaleString() + ' MT). Overall ETC: ' + fmt24(overallEtc) + '.'
        };
      }
    }

    /* ── Case B: Partial MGO — one barge does VLSFO + partial MGO, another does remaining MGO ──
       Uses availRm (ROB after this barge's own earlier commitments), not
       raw live ROB, and real timeline-aware start times. */
    var vOnlyBarge = bargeResults.find(function (r) { return r.availRv >= vReq; });
    if (vOnlyBarge && vOnlyBarge.availRm > 0 && vOnlyBarge.availRm < mReq) {
      var vOnlyMgo  = vOnlyBarge.availRm;
      var remainMgo = mReq - vOnlyMgo;
      var mRestB    = bargeResults.find(function (r) {
        return r.b.id !== vOnlyBarge.b.id && r.availRm >= remainMgo;
      });
      if (mRestB) {
        var vJobHrs   = hoseHrs + Math.max(vReq / (vOnlyBarge.b.vtph || 300), vOnlyMgo / (vOnlyBarge.b.mtph || 100));
        var vStart    = timingForHrs(vOnlyBarge, vJobHrs, requestedETA, null).start;
        var vEtc      = addHrs(vStart, vJobHrs);
        var mTl       = mRestB.timeline || [];
        var mJobHrs   = hoseHrs + remainMgo / (mRestB.b.mtph || 100);
        // Phase 8: one barge alongside at a time — the MGO barge can't come
        // alongside until the first barge has finished and cast off.
        var berthClear = addHrs(vEtc, travelHrs);
        var mFreeAt   = timingForHrs(mRestB, mJobHrs, berthClear, berthClear).start;
        mFreeAt       = new Date(Math.max(mFreeAt.getTime(), berthClear.getTime()));
        var mEtc      = addHrs(mFreeAt, mJobHrs);
        var mPrevOps  = mTl.filter(function (op) { return addHrs(_opBusyEnd(op), travelHrs) <= mFreeAt; });
        return {
          type: 'partial_mgo',
          vBarge: vOnlyBarge, mBarge: mRestB,
          vOnlyMgo: vOnlyMgo, remainMgo: remainMgo,
          vStart: vStart, vEtc: vEtc,
          mFreeAt: mFreeAt, mEtc: mEtc, overallEtc: mEtc,
          mLastOp: mPrevOps.length ? mPrevOps[mPrevOps.length - 1] : null,
          berthOk: mFreeAt.getTime() >= berthClear.getTime(),
          summary: vOnlyBarge.b.name + ' (VLSFO + partial MGO) + ' + mRestB.b.name + ' (remaining MGO)',
          plan: vOnlyBarge.b.name + ' alongside ' + fmt24(vStart) + ' for ' + vReq.toLocaleString() + ' MT VLSFO + ' + vOnlyMgo.toLocaleString() + ' MT MGO. ' +
                mRestB.b.name + ' follows from ' + fmt24(mFreeAt) + ' for remaining ' + remainMgo.toLocaleString() + ' MT MGO. Overall ETC: ' + fmt24(mEtc) + '.'
        };
      }
    }

    /* ── Fallback: any barge with stock (after ops complete) — committed
       ROB respected (availRv/availRm), not raw live ROB. ── */
    var anyVb = bargeResults.find(function (r) { return r.availRv >= vReq; });
    var anyMb = bargeResults.find(function (r) { return r.availRm >= mReq && (!anyVb || r.b.id !== anyVb.b.id); });
    if (anyVb && anyMb) {
      var avT  = splitTiming(anyVb, vReq, anyVb.b.vtph || 300);
      var amT  = splitTiming(anyMb, mReq, anyMb.b.mtph || 100);
      var aFirst = avT.start <= amT.start ? avT : amT;
      var aFirstR = avT.start <= amT.start ? anyVb : anyMb;
      var aFirstF = avT.start <= amT.start ? 'VLSFO' : 'MGO';
      var aFirstQ = avT.start <= amT.start ? vReq : mReq;
      var aFirstT = avT.start <= amT.start ? (anyVb.b.vtph || 300) : (anyMb.b.mtph || 100);
      var aSecond = avT.start <= amT.start ? amT : avT;
      var aSecondR = avT.start <= amT.start ? anyMb : anyVb;
      var aSecondF = avT.start <= amT.start ? 'MGO' : 'VLSFO';
      var aSecondQ = avT.start <= amT.start ? mReq : vReq;
      var aSecondT = avT.start <= amT.start ? (anyMb.b.mtph || 100) : (anyVb.b.vtph || 300);
      var aFJ   = hoseHrs + aFirstQ / aFirstT;
      var aFE   = addHrs(aFirst.start, aFJ);
      var aFD   = addHrs(aFE, travelHrs);
      var aSJ   = hoseHrs + aSecondQ / aSecondT;
      // Second barge waits for the berth AND must still be conflict-free on
      // its own timeline at that later time.
      var aSS   = timingForHrs(aSecondR, aSJ, aFD, aFD).start;
      aSS       = new Date(Math.max(aSS.getTime(), aFD.getTime()));
      var aSE   = addHrs(aSS, aSJ);
      return {
        type: 'standard_after_ops',
        vBarge: anyVb, mBarge: anyMb,
        firstR: aFirstR, secondR: aSecondR,
        firstFuel: aFirstF, secondFuel: aSecondF,
        firstQty: aFirstQ, secondQty: aSecondQ,
        firstTph: aFirstT, secondTph: aSecondT,
        firstStart: aFirst.start, firstEtc: aFE, firstDepart: aFD,
        secondStart: aSS, secondEtc: aSE, overallEtc: aSE,
        secondDelayed: aSS > aSecond.start,
        secondDelayHrs: aSS > aSecond.start ? (aSS - aSecond.start) / 3600000 : 0,
        berthOk: aSS.getTime() >= aFD.getTime(),
        summary: aFirstR.b.name + ' (' + aFirstF + ') + ' + aSecondR.b.name + ' (' + aSecondF + ') — after ops complete',
        plan: aFirstR.b.name + ' alongside ' + fmt24(aFirst.start) + '→' + fmt24(aFE) + ' (' + aFirstF + ' ' + aFirstQ.toLocaleString() + ' MT). ' +
              aSecondR.b.name + ' alongside ' + fmt24(aSS) + '→' + fmt24(aSE) + ' (' + aSecondF + ' ' + aSecondQ.toLocaleString() + ' MT). Overall ETC: ' + fmt24(aSE) + '.'
      };
    }
  }

  /* ── Case C: Single-fuel VLSFO — two-barge split OR STS consolidation ──
     RULE: A genuine two-barge SPLIT (each barge independently supplies its
     own portion direct to the vessel) only makes sense when the requested
     qty exceeds what ANY single barge could physically hold/supply — e.g.
     one barge's max capacity is 5,000 MT and the client needs 6,000 MT.
     If the requested qty is within a single barge's capacity but no one
     barge currently has enough ROB on board, the correct real-world move
     is STS: the barge holding LESS transfers its stock into the barge
     holding MORE, consolidating onto one barge that then alone supplies
     the vessel — not splitting the supply itself across two barges. */
  if (vReq > 0 && mReq === 0) {
    var maxSingleVCap = 0;
    for (var mci = 0; mci < bargeResults.length; mci++) {
      maxSingleVCap = Math.max(maxSingleVCap, bargeResults[mci].b.vcap || 0);
    }

    if (vReq > maxSingleVCap) {
      // Genuinely beyond one barge's capacity — real parallel split needed.
      var vCombos = [];
      for (var ai = 0; ai < bargeResults.length; ai++) {
        for (var bi2 = ai + 1; bi2 < bargeResults.length; bi2++) {
          var rA = bargeResults[ai], rB = bargeResults[bi2];
          if (rA.availRv + rB.availRv >= vReq) {
            // Split quantities proportionally by available ROB
            var qA   = Math.min(rA.availRv, vReq);
            var qB   = Math.max(0, vReq - qA);
            if (qB > rB.availRv) { qB = rB.availRv; qA = Math.max(0, vReq - qB); }
            if (qA <= 0 || qB <= 0) continue;
            var tA  = splitTiming(rA, qA, rA.b.vtph || 300);
            var tB  = splitTiming(rB, qB, rB.b.vtph || 300);
            var fst = tA.start <= tB.start ? tA : tB;
            var fstR= tA.start <= tB.start ? rA : rB;
            var snd = tA.start <= tB.start ? tB : tA;
            var sndR= tA.start <= tB.start ? rB : rA;
            var fQ  = tA.start <= tB.start ? qA : qB;
            var sQ  = tA.start <= tB.start ? qB : qA;
            var fT  = fstR.b.vtph || 300;
            var sT  = sndR.b.vtph || 300;
            var fJH = hoseHrs + fQ / fT;
            var fE  = addHrs(fst.start, fJH);
            var fD  = addHrs(fE, travelHrs);
            var sS  = new Date(Math.max(snd.start.getTime(), fD.getTime()));
            var sJH = hoseHrs + sQ / sT;
            var sE  = addHrs(sS, sJH);
            vCombos.push({
              type: 'vlsfo_split',
              firstR: fstR, secondR: sndR,
              firstQty: fQ, secondQty: sQ,
              firstStart: fst.start, firstEtc: fE, firstDepart: fD,
              secondStart: sS, secondEtc: sE, overallEtc: sE,
              secondDelayed: sS > snd.start,
              secondDelayHrs: sS > snd.start ? (sS - snd.start) / 3600000 : 0,
              berthOk: true,
              summary: fstR.b.name + ' + ' + sndR.b.name + ' (VLSFO split ' + Math.round(fQ).toLocaleString() + ' + ' + Math.round(sQ).toLocaleString() + ' MT — exceeds single barge capacity of ' + maxSingleVCap.toLocaleString() + ' MT)',
              plan: fstR.b.name + ' alongside ' + fmt24(fst.start) + '→' + fmt24(fE) + ' (VLSFO ' + Math.round(fQ).toLocaleString() + ' MT). ' +
                    sndR.b.name + ' alongside ' + fmt24(sS) + '→' + fmt24(sE) + ' (VLSFO ' + Math.round(sQ).toLocaleString() + ' MT). Total VLSFO: ' + vReq.toLocaleString() + ' MT. Overall ETC: ' + fmt24(sE) + '.'
            });
          }
        }
      }
      if (vCombos.length) {
        vCombos.sort(function (a, b) { return a.overallEtc - b.overallEtc; });
        return vCombos[0];
      }
    } else {
      // Within a single barge's capacity — try STS consolidation instead
      // of a two-barge split.
      var vStsCombos = [];
      for (var si = 0; si < bargeResults.length; si++) {
        for (var sj = 0; sj < bargeResults.length; sj++) {
          if (si === sj) continue;
          var recipient = bargeResults[si], donor = bargeResults[sj];
          // Recipient must be the one holding MORE right now, and its own
          // tank must be physically able to hold/supply the full request.
          if (donor.availRv >= recipient.availRv) continue;
          // Recipient already holds enough — it can supply alone (perhaps
          // later); an STS would be a needless transfer.
          if (recipient.availRv >= vReq) continue;
          if ((recipient.b.vcap || 0) < vReq) continue;
          var headroom    = Math.max(0, (recipient.b.vcap || 0) - recipient.availRv);
          var transferAmt = Math.min(donor.availRv, headroom);
          var afterTransfer = recipient.availRv + transferAmt;
          if (afterTransfer < vReq) continue; // consolidation still isn't enough
          // STS transfer itself takes time — modelled the same way as a
          // supply job (hose connect + pumped qty at the recipient's own
          // transfer rate), then the recipient supplies the vessel after.
          var stsJobHrs = hoseHrs + transferAmt / (recipient.b.vtph || 300);
          var supplyJobHrs = hoseHrs + vReq / (recipient.b.vtph || 300);
          // Both barges' own timelines decide when the STS can happen.
          var stsStart  = stsTiming(recipient, donor, stsJobHrs, supplyJobHrs);
          var stsEnd    = addHrs(stsStart, stsJobHrs);
          var supplyStart = requestedETA && requestedETA > stsEnd ? requestedETA : stsEnd;
          var supplyEtc = addHrs(supplyStart, supplyJobHrs);
          vStsCombos.push({
            type: 'vlsfo_sts',
            recipient: recipient, donor: donor,
            transferAmt: transferAmt, vReq: vReq,
            stsStart: stsStart, stsEnd: stsEnd,
            supplyStart: supplyStart, supplyEtc: supplyEtc,
            overallEtc: supplyEtc,
            berthOk: true,
            summary: donor.b.name + ' → ' + recipient.b.name + ' STS (' + Math.round(transferAmt).toLocaleString() + ' MT), then ' + recipient.b.name + ' supplies ' + Math.round(vReq).toLocaleString() + ' MT VLSFO',
            plan: donor.b.name + ' transfers ' + Math.round(transferAmt).toLocaleString() + ' MT VLSFO to ' + recipient.b.name + ' via STS (' + fmt24(stsStart) + '→' + fmt24(stsEnd) + '), bringing ' + recipient.b.name + ' to ' + Math.round(afterTransfer).toLocaleString() + ' MT. ' + recipient.b.name + ' then supplies the full ' + Math.round(vReq).toLocaleString() + ' MT VLSFO to the vessel ' + fmt24(supplyStart) + '→' + fmt24(supplyEtc) + '.'
          });
        }
      }
      if (vStsCombos.length) {
        vStsCombos.sort(function (a, b) { return a.overallEtc - b.overallEtc; });
        return vStsCombos[0];
      }
    }
  }

  /* ── Case D: Single-fuel MGO — two-barge split OR STS consolidation ──
     Same rule as Case C above, applied to MGO. */
  if (mReq > 0 && vReq === 0) {
    var maxSingleMCap = 0;
    for (var mci2 = 0; mci2 < bargeResults.length; mci2++) {
      maxSingleMCap = Math.max(maxSingleMCap, bargeResults[mci2].b.mcap || 0);
    }

    if (mReq > maxSingleMCap) {
      // Genuinely beyond one barge's capacity — real parallel split needed.
      for (var ai2 = 0; ai2 < bargeResults.length; ai2++) {
        for (var bi3 = ai2 + 1; bi3 < bargeResults.length; bi3++) {
          var rC = bargeResults[ai2], rD = bargeResults[bi3];
          if (rC.availRm + rD.availRm >= mReq) {
            var qC   = Math.min(rC.availRm, mReq);
            var qD   = Math.max(0, mReq - qC);
            if (qD > rD.availRm) { qD = rD.availRm; qC = Math.max(0, mReq - qD); }
            if (qC <= 0 || qD <= 0) continue;
            var tC  = splitTiming(rC, qC, rC.b.mtph || 100);
            var tD  = splitTiming(rD, qD, rD.b.mtph || 100);
            var fst2= tC.start <= tD.start ? tC : tD;
            var fstR2= tC.start <= tD.start ? rC : rD;
            var snd2= tC.start <= tD.start ? tD : tC;
            var sndR2= tC.start <= tD.start ? rD : rC;
            var fQ2  = tC.start <= tD.start ? qC : qD;
            var sQ2  = tC.start <= tD.start ? qD : qC;
            var fT2  = fstR2.b.mtph || 100;
            var sT2  = sndR2.b.mtph || 100;
            var fJH2 = hoseHrs + fQ2 / fT2;
            var fE2  = addHrs(fst2.start, fJH2);
            var fD2  = addHrs(fE2, travelHrs);
            var sS2  = new Date(Math.max(snd2.start.getTime(), fD2.getTime()));
            var sJH2 = hoseHrs + sQ2 / sT2;
            var sE2  = addHrs(sS2, sJH2);
            return {
              type: 'mgo_split',
              firstR: fstR2, secondR: sndR2,
              firstQty: fQ2, secondQty: sQ2,
              firstStart: fst2.start, firstEtc: fE2, firstDepart: fD2,
              secondStart: sS2, secondEtc: sE2, overallEtc: sE2,
              secondDelayed: sS2 > snd2.start,
              secondDelayHrs: sS2 > snd2.start ? (sS2 - snd2.start) / 3600000 : 0,
              berthOk: true,
              summary: fstR2.b.name + ' + ' + sndR2.b.name + ' (MGO split ' + Math.round(fQ2).toLocaleString() + ' + ' + Math.round(sQ2).toLocaleString() + ' MT — exceeds single barge capacity of ' + maxSingleMCap.toLocaleString() + ' MT)',
              plan: fstR2.b.name + ' alongside ' + fmt24(fst2.start) + '→' + fmt24(fE2) + ' (MGO ' + Math.round(fQ2).toLocaleString() + ' MT). ' +
                    sndR2.b.name + ' alongside ' + fmt24(sS2) + '→' + fmt24(sE2) + ' (MGO ' + Math.round(sQ2).toLocaleString() + ' MT). Total MGO: ' + mReq.toLocaleString() + ' MT. Overall ETC: ' + fmt24(sE2) + '.'
            };
          }
        }
      }
    } else {
      // Within a single barge's capacity — try STS consolidation instead.
      var mStsCombos = [];
      for (var si2 = 0; si2 < bargeResults.length; si2++) {
        for (var sj2 = 0; sj2 < bargeResults.length; sj2++) {
          if (si2 === sj2) continue;
          var recipientM = bargeResults[si2], donorM = bargeResults[sj2];
          if (donorM.availRm >= recipientM.availRm) continue;
          if (recipientM.availRm >= mReq) continue; // can supply alone — no STS needed
          if ((recipientM.b.mcap || 0) < mReq) continue;
          var headroomM    = Math.max(0, (recipientM.b.mcap || 0) - recipientM.availRm);
          var transferAmtM = Math.min(donorM.availRm, headroomM);
          var afterTransferM = recipientM.availRm + transferAmtM;
          if (afterTransferM < mReq) continue;
          var stsJobHrsM = hoseHrs + transferAmtM / (recipientM.b.mtph || 100);
          var supplyJobHrsM = hoseHrs + mReq / (recipientM.b.mtph || 100);
          var stsStartM  = stsTiming(recipientM, donorM, stsJobHrsM, supplyJobHrsM);
          var stsEndM    = addHrs(stsStartM, stsJobHrsM);
          var supplyStartM = requestedETA && requestedETA > stsEndM ? requestedETA : stsEndM;
          var supplyEtcM = addHrs(supplyStartM, supplyJobHrsM);
          mStsCombos.push({
            type: 'mgo_sts',
            recipient: recipientM, donor: donorM,
            transferAmt: transferAmtM, mReq: mReq,
            stsStart: stsStartM, stsEnd: stsEndM,
            supplyStart: supplyStartM, supplyEtc: supplyEtcM,
            overallEtc: supplyEtcM,
            berthOk: true,
            summary: donorM.b.name + ' → ' + recipientM.b.name + ' STS (' + Math.round(transferAmtM).toLocaleString() + ' MT), then ' + recipientM.b.name + ' supplies ' + Math.round(mReq).toLocaleString() + ' MT MGO',
            plan: donorM.b.name + ' transfers ' + Math.round(transferAmtM).toLocaleString() + ' MT MGO to ' + recipientM.b.name + ' via STS (' + fmt24(stsStartM) + '→' + fmt24(stsEndM) + '), bringing ' + recipientM.b.name + ' to ' + Math.round(afterTransferM).toLocaleString() + ' MT. ' + recipientM.b.name + ' then supplies the full ' + Math.round(mReq).toLocaleString() + ' MT MGO to the vessel ' + fmt24(supplyStartM) + '→' + fmt24(supplyEtcM) + '.'
          });
        }
      }
      if (mStsCombos.length) {
        mStsCombos.sort(function (a, b) { return a.overallEtc - b.overallEtc; });
        return mStsCombos[0];
      }
    }
  }

  return null; // No viable split found
}

/* ═════════════════════════════════════════════════════════════════════
   SPLIT SUPPLY HTML CARD BUILDER — Phase 7 output
   ═════════════════════════════════════════════════════════════════════ */
function _buildSplitSupplyCard(splitResult, requestedETA, vReq, mReq, travelHrs, hoseHrs) {
  var type = splitResult.type || 'standard';

  /* ── Partial MGO split ── */
  if (type === 'partial_mgo') {
    var vB   = splitResult.vBarge;
    var mB   = splitResult.mBarge;
    var vStart = splitResult.vStart;
    var vEtc   = splitResult.vEtc;
    var mFreeAt= splitResult.mFreeAt;
    var mEtc   = splitResult.mEtc;
    var mLast  = splitResult.mLastOp;
    var vAfterV= Math.max(0, vB.availRv - vReq);
    var vAfterM= Math.max(0, vB.availRm - splitResult.vOnlyMgo);
    var mAfterM= Math.max(0, mB.availRm - splitResult.remainMgo);

    return '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:4px">Split Supply — Coordinated Two-Barge Operation</div>' +
      '<div style="font-size:11.5px;color:var(--amber);font-style:italic;margin-bottom:14px">' + esc(vB.b.name) + ' supplies VLSFO + partial MGO on arrival. ' + esc(mB.b.name) + ' supplies remaining MGO after its planned op completes.</div>' +

      '<div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Phase 1 — ' + (requestedETA && vStart > requestedETA ? 'First Barge Alongside' : 'On Vessel Arrival') + '</div>' +
      '<div style="background:var(--surface);border:1.5px solid var(--azure-bd);border-radius:10px;padding:13px;margin-bottom:12px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--fuel-v);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' + esc(vB.b.name) + ' — VLSFO + Partial LSMGO</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">VLSFO Supply</div><div style="font-size:14px;font-weight:700;color:var(--fuel-v);font-family:\'DM Mono\',monospace">' + vReq.toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">MGO Supply (partial)</div><div style="font-size:14px;font-weight:700;color:var(--fuel-m);font-family:\'DM Mono\',monospace">' + (splitResult.vOnlyMgo > 0 ? splitResult.vOnlyMgo.toLocaleString() + ' MT' : '—') + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Status</div>' + (requestedETA && vStart > requestedETA ? '<div style="font-size:11px;font-weight:700;color:var(--amber)">⏳ Free from ' + fmt24(vStart) + '</div>' : '<div style="font-size:11px;font-weight:700;color:var(--green)">✓ Free on arrival</div>') + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--border2)">' +
          '<div><div style="font-size:9px;color:var(--muted)">Start</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(vStart) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ETC</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(vEtc) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ROB after</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace;color:' + (vAfterV < vB.b.vbuf ? 'var(--red)' : 'var(--azure)') + '">' + Math.round(vAfterV).toLocaleString() + ' MT V / ' + Math.round(vAfterM).toLocaleString() + ' MT M</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Phase 2 — After ' + esc(mB.b.name) + '\'s Planned Supply Completes</div>' +
      '<div style="background:var(--surface);border:1.5px solid var(--fuel-m-bd);border-radius:10px;padding:13px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--fuel-m);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' + esc(mB.b.name) + ' — Remaining LSMGO</div>' +
        (mLast ? '<div style="font-size:11px;color:var(--sub);margin-bottom:8px;padding:6px 10px;background:var(--amber-lt);border-radius:6px;border:1px solid var(--amber-bd)">⚠ Blocked until: <strong>' + esc(mLast.vessel) + '</strong> supply ETC <strong style="font-family:\'DM Mono\',monospace">' + fmt24(mLast.etc) + '</strong></div>' : '') +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Remaining MGO</div><div style="font-size:14px;font-weight:700;color:var(--fuel-m);font-family:\'DM Mono\',monospace">' + splitResult.remainMgo.toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Live MGO ROB</div><div style="font-size:14px;font-weight:700;color:var(--fuel-m);font-family:\'DM Mono\',monospace">' + Math.round(mB.liveRm).toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">ROB after</div><div style="font-size:14px;font-weight:700;font-family:\'DM Mono\',monospace;color:' + (mAfterM < mB.b.mbuf ? 'var(--red)' : 'var(--teal)') + '">' + Math.round(mAfterM).toLocaleString() + ' MT</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--border2)">' +
          '<div><div style="font-size:9px;color:var(--muted)">Free from</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace;color:var(--amber)">' + fmt24(mFreeAt) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ETC (remaining MGO)</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(mEtc) + '</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="margin-top:12px;padding:10px 14px;background:rgba(255,255,255,.7);border-radius:8px;border:1px solid var(--amber-bd);font-size:11px;color:var(--sub)">' +
        '<strong>Summary:</strong> Vessel receives ' + vReq.toLocaleString() + ' MT VLSFO + ' + (splitResult.vOnlyMgo > 0 ? splitResult.vOnlyMgo.toLocaleString() : '0') + ' MT MGO from ' + esc(vB.b.name) + ' at arrival (' + fmt24(vStart) + '), then ' + splitResult.remainMgo.toLocaleString() + ' MT remaining MGO from ' + esc(mB.b.name) + ' from ' + fmt24(mFreeAt) + '. Total MGO: ' + mReq.toLocaleString() + ' MT. Overall ETC: ' + fmt24(mEtc) + '.' +
      '</div></div>';
  }

  /* ── STS consolidation (within single-barge capacity) ── */
  if (type === 'vlsfo_sts' || type === 'mgo_sts') {
    var fuelLabel   = type === 'vlsfo_sts' ? 'VLSFO' : 'MGO';
    var fuelCol     = type === 'vlsfo_sts' ? 'var(--fuel-v)' : 'var(--fuel-m)';
    var recipient   = splitResult.recipient;
    var donor       = splitResult.donor;
    var transferAmt = splitResult.transferAmt;
    var reqQty      = splitResult.vReq || splitResult.mReq;
    var recAvailBefore = type === 'vlsfo_sts' ? recipient.availRv : recipient.availRm;
    var recAvailAfter  = recAvailBefore + transferAmt;

    return '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:4px">STS Consolidation — Within Single Barge Capacity</div>' +
      '<div style="font-size:11.5px;color:var(--amber);font-style:italic;margin-bottom:14px">Requested qty fits within one barge\'s tank capacity — rather than splitting supply across two barges, ' + esc(donor.b.name) + ' transfers its ' + fuelLabel + ' into ' + esc(recipient.b.name) + ' first, then ' + esc(recipient.b.name) + ' alone supplies the full amount.</div>' +

      '<div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Phase 1 — STS Transfer</div>' +
      '<div style="background:var(--surface);border:1.5px solid var(--azure-bd);border-radius:10px;padding:13px;margin-bottom:12px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--azure);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' + esc(donor.b.name) + ' → ' + esc(recipient.b.name) + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Transfer Qty</div><div style="font-size:14px;font-weight:700;color:' + fuelCol + ';font-family:\'DM Mono\',monospace">' + Math.round(transferAmt).toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">' + esc(recipient.b.name) + ' Before</div><div style="font-size:14px;font-weight:700;font-family:\'DM Mono\',monospace">' + Math.round(recAvailBefore).toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">' + esc(recipient.b.name) + ' After</div><div style="font-size:14px;font-weight:700;font-family:\'DM Mono\',monospace;color:var(--green)">' + Math.round(recAvailAfter).toLocaleString() + ' MT</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--border2)">' +
          '<div><div style="font-size:9px;color:var(--muted)">Start</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(splitResult.stsStart) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">Complete</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(splitResult.stsEnd) + '</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Phase 2 — Vessel Supply</div>' +
      '<div style="background:var(--surface);border:1.5px solid ' + (type === 'vlsfo_sts' ? 'var(--fuel-v-bd)' : 'var(--fuel-m-bd)') + ';border-radius:10px;padding:13px">' +
        '<div style="font-size:10px;font-weight:700;color:' + fuelCol + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' + esc(recipient.b.name) + ' — Full ' + fuelLabel + ' Supply</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Supply Qty</div><div style="font-size:14px;font-weight:700;color:' + fuelCol + ';font-family:\'DM Mono\',monospace">' + Math.round(reqQty).toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">Start</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(splitResult.supplyStart) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ETC</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(splitResult.supplyEtc) + '</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="margin-top:12px;padding:10px 14px;background:rgba(255,255,255,.7);border-radius:8px;border:1px solid var(--amber-bd);font-size:11px;color:var(--sub)">' +
        '<strong>Summary:</strong> ' + esc(donor.b.name) + ' transfers ' + Math.round(transferAmt).toLocaleString() + ' MT ' + fuelLabel + ' to ' + esc(recipient.b.name) + ' (' + fmt24(splitResult.stsStart) + '→' + fmt24(splitResult.stsEnd) + '), then ' + esc(recipient.b.name) + ' alone supplies the full ' + Math.round(reqQty).toLocaleString() + ' MT to the vessel (' + fmt24(splitResult.supplyStart) + '→' + fmt24(splitResult.supplyEtc) + ').' +
      '</div></div>';
  }

  /* ── Standard / single-fuel / after-ops split ── */
  var fR  = splitResult.firstR;
  var sR  = splitResult.secondR;
  var fF  = splitResult.firstFuel || (type === 'vlsfo_split' ? 'VLSFO' : type === 'mgo_split' ? 'MGO' : 'VLSFO');
  var sF  = splitResult.secondFuel || fF;
  var fQ  = splitResult.firstQty;
  var sQ  = splitResult.secondQty;
  var fT  = splitResult.firstTph;
  var sT  = splitResult.secondTph;
  var fs  = splitResult.firstStart;
  var fe  = splitResult.firstEtc;
  var fd  = splitResult.firstDepart;
  var ss  = splitResult.secondStart;
  var se  = splitResult.secondEtc;
  var oe  = splitResult.overallEtc;
  var sd  = splitResult.secondDelayed;
  var sdh = splitResult.secondDelayHrs;
  var totalHrs = (oe - fs) / 3600000;
  var fCol = fF === 'VLSFO' ? 'var(--fuel-v)' : 'var(--fuel-m)';
  var sBd  = sF === 'VLSFO' ? 'var(--fuel-v-bd)' : 'var(--fuel-m-bd)';
  var fBd2 = fF === 'VLSFO' ? 'var(--fuel-v-bd)' : 'var(--fuel-m-bd)';
  var sCol = sF === 'VLSFO' ? 'var(--fuel-v)' : 'var(--fuel-m)';

  var typeLabel = type === 'vlsfo_split' ? 'Split Supply — VLSFO Across Two Barges'
               : type === 'mgo_split'    ? 'Split Supply — MGO Across Two Barges'
               : type.includes('after_ops') ? 'Split Supply — Two Barges (After Ops)'
               : 'Sequential Split Supply — Two Barges';

  return '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
    '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:4px">' + typeLabel + '</div>' +
    '<div style="font-size:11.5px;color:var(--amber);font-style:italic;margin-bottom:14px">Each barge starts at its own earliest available time. One barge alongside at a time (Phase 8).</div>' +

    // Timeline overview
    '<div style="background:rgba(255,255,255,.8);border:1px solid var(--amber-bd);border-radius:10px;padding:12px 16px;margin-bottom:14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">' +
        '<div><div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--amber);letter-spacing:.08em;margin-bottom:3px">Operation Starts</div>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--ink)">' + fmt24(fs) + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">' + esc(fR.b.name) + ' begins</div>' +
        '</div>' +
        '<div style="border-left:1px solid var(--amber-bd);padding-left:14px"><div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--sub);letter-spacing:.08em;margin-bottom:3px">Overall ETC</div>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--ink)">' + fmt24(oe) + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">All fuels complete</div>' +
        '</div>' +
        '<div style="border-left:1px solid var(--amber-bd);padding-left:14px"><div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--sub);letter-spacing:.08em;margin-bottom:3px">Total Duration</div>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--ink)">' + totalHrs.toFixed(1) + ' hrs</div>' +
          '<div style="font-size:10px;color:' + (requestedETA && fs > requestedETA ? 'var(--red)' : 'var(--green)') + '">' +
            (requestedETA && fs > requestedETA ? '+' + ((fs - requestedETA) / 3600000).toFixed(1) + 'h after ETA' : '✓ On requested time') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Barge cards
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
    _splitBargeCardV5(fR, fF, fQ, fT, fs, fe, fCol, fBd2, false, 0, 1, hoseHrs) +
    _splitBargeCardV5(sR, sF, sQ, sT, ss, se, sCol, sBd,  sd,  sdh, 2, hoseHrs) +
    '</div>' +

    // Berth sequence note
    '<div style="margin-top:12px;padding:8px 14px;background:rgba(255,255,255,.6);border-radius:8px;border:1px solid var(--amber-bd);font-size:11px;color:var(--sub)">' +
      '<strong>Berth sequence (Phase 8):</strong> ' + esc(fR.b.name) + ' alongside ' + fmt24(fs) + '→' + fmt24(fe) + ', departs ' + fmt24(fd) + '. ' +
      esc(sR.b.name) + ' comes alongside ' + fmt24(ss) + '→' + fmt24(se) + '.' +
      (sd ? ' <span style="color:var(--amber)">(' + esc(sR.b.name) + ' waits ' + sdh.toFixed(1) + 'h for berth to clear.)</span>' : '') +
    '</div>' +
  '</div>';
}

function _splitBargeCardV5(r, fuel, qty, tph, start, etc, col, bd, delayed, delayHrs, phase, hoseHrs) {
  if (!r) return '<div></div>';
  var pumpH  = (qty / (tph || 300)).toFixed(1);
  var hasOps = r.timeline && r.timeline.length > 0;
  var statusLabel = !hasOps
    ? '<span style="color:var(--green);font-weight:700">✓ Free — starts on arrival</span>'
    : delayed
      ? '<span style="color:var(--amber);font-weight:700">⏳ Waits for berth (' + delayHrs.toFixed(1) + 'h)</span>'
      : '<span style="color:var(--azure);font-weight:700">✓ Free at ' + fmt24(start) + '</span>';
  var robAfterV = fuel === 'VLSFO' ? Math.max(0, (r.availRv || 0) - qty) : (r.availRv || 0);
  var robAfterM = fuel === 'MGO' || fuel === 'LSMGO' ? Math.max(0, (r.availRm || 0) - qty) : (r.availRm || 0);
  return '<div style="background:var(--surface);border:1.5px solid ' + bd + ';border-radius:10px;padding:13px;position:relative">' +
    '<div style="position:absolute;top:10px;right:12px;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + col + '22;color:' + col + '">Phase ' + phase + '</div>' +
    '<div style="font-size:10px;font-weight:700;color:' + col + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px">' + esc(r.b.name) + ' — ' + fuel + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--sub)">' +
      '<div>Supply: <strong style="color:var(--green)">' + qty.toLocaleString() + ' MT ✓</strong></div>' +
      '<div>Pump: <strong>' + pumpH + ' hrs</strong> + ' + hoseHrs + 'h hose-up</div>' +
      '<div>Status: ' + statusLabel + '</div>' +
      '<div>Alongside: <strong style="font-family:\'DM Mono\',monospace;color:' + col + '">' + fmt24(start) + '</strong></div>' +
      '<div>ETC: <strong style="font-family:\'DM Mono\',monospace">' + fmt24(etc) + '</strong></div>' +
      '<div>Departs: <strong style="font-family:\'DM Mono\',monospace">' + fmt24(addHrs(etc, _calcParams.travelHrs)) + '</strong></div>' +
      '<div>ROB after: <strong style="font-family:\'DM Mono\',monospace">' +
        (fuel === 'VLSFO' ? Math.round(robAfterV).toLocaleString() + ' MT VLSFO' : Math.round(robAfterM).toLocaleString() + ' MT MGO') +
      '</strong></div>' +
      (hasOps && !delayed ? '<div style="font-size:10px;color:var(--muted);border-top:1px solid var(--border2);margin-top:4px;padding-top:4px">Own ops: ' + r.timeline.map(function (op) { return esc(op.vessel) + ' (→' + fmt24(op.etc) + ')'; }).join(', ') + '</div>' : '') +
    '</div>' +
  '</div>';
}

function _buildForwardImpactPanel(a) {
  var nvi = a.nextVesselImpact;
  if (!nvi) return '';
  var ok = nvi.canReloadBeforeNext && nvi.canSupplyNext;
  var borderColor = ok ? 'var(--green-bd)' : nvi.canSupplyNext ? 'var(--amber-bd)' : 'var(--red-bd)';
  var bgColor     = ok ? 'var(--green-lt)' : nvi.canSupplyNext ? 'var(--amber-lt)' : 'var(--red-lt)';
  var textColor   = ok ? 'var(--green)'    : nvi.canSupplyNext ? 'var(--amber)'    : 'var(--red)';
  return '<div style="border:1.5px solid ' + borderColor + ';border-radius:10px;padding:12px 16px;background:' + bgColor + ';margin-top:10px">' +
    '<div style="font-size:10px;font-weight:700;color:' + textColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Forward Impact — Next Vessel: ' + esc(nvi.vessel) + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:12px">' +
    '<div><div style="font-size:9px;color:var(--muted);margin-bottom:3px">Next Vessel ETA</div><div style="font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(nvi.eta) + '</div></div>' +
    '<div><div style="font-size:9px;color:var(--muted);margin-bottom:3px">Reload Needed</div><div style="font-weight:700">' + (nvi.reloadNeeded ? nvi.reloadQty.toLocaleString() + ' MT' : 'No') + '</div></div>' +
    '<div><div style="font-size:9px;color:var(--muted);margin-bottom:3px">Can Reload In Time</div><div style="font-weight:700;color:' + (nvi.canReloadBeforeNext ? 'var(--green)' : 'var(--red)') + '">' + (nvi.canReloadBeforeNext ? 'Yes' : 'No') + '</div></div>' +
    '</div>' +
    '<div style="font-size:11.5px;color:var(--sub);margin-top:8px">' +
    (nvi.canReloadBeforeNext && nvi.canSupplyNext ? 'Sufficient time to reload and supply next vessel.' : '') +
    (!nvi.canReloadBeforeNext ? ' Insufficient time to reload before next vessel arrives (' + esc(nvi.vessel) + ' ETA ' + fmt24(nvi.eta) + ', reload takes ' + (nvi.reloadHrs || '?') + ' hrs).' : '') +
    (nvi.canSupplyNext ? '' : ' Post-supply ROB also insufficient to serve ' + esc(nvi.vessel) + ' without refuelling.') +
    '</div></div>';
}



