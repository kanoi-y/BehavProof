module order {
  var paid: bool
  var shipped: bool
  var cancelled: bool
  var refunds: int
  var replayOutcome: str

  action init = all {
    paid' = false,
    shipped' = false,
    cancelled' = false,
    refunds' = 0,
    replayOutcome' = "allowed",
  }
  action Pay = all {
    not(paid), not(cancelled),
    paid' = true,
    shipped' = shipped, cancelled' = cancelled, refunds' = refunds,
    replayOutcome' = "allowed",
  }
  action Ship = all {
    paid, not(shipped), not(cancelled), refunds == 0,
    shipped' = true,
    paid' = paid, cancelled' = cancelled, refunds' = refunds,
    replayOutcome' = "allowed",
  }
  action TryShipUnpaid = all {
    not(paid),
    paid' = paid, shipped' = shipped, cancelled' = cancelled, refunds' = refunds,
    replayOutcome' = "rejected",
  }
  action Cancel = all {
    not(shipped), not(cancelled),
    cancelled' = true,
    refunds' = if (paid) 1 else 0,
    paid' = paid, shipped' = shipped,
    replayOutcome' = "allowed",
  }
  action Refund = all {
    paid, not(shipped), not(cancelled), refunds == 0,
    refunds' = 1,
    paid' = paid, shipped' = shipped, cancelled' = cancelled,
    replayOutcome' = "allowed",
  }
  action Wait = all {
    paid' = paid, shipped' = shipped, cancelled' = cancelled, refunds' = refunds,
    replayOutcome' = "allowed",
  }
  action step = any { Pay, Ship, TryShipUnpaid, Cancel, Refund, Wait }
  val refundAtMostOnce = refunds <= 1
  val noRefundAfterShipping = not(shipped and refunds > 0)
  val refundReached = refunds == 1
  run refundTest = init.then(Pay).then(Refund).expect(refunds == 1)
  run unpaidShipmentTest = init.then(TryShipUnpaid).expect(not(shipped) and replayOutcome == "rejected")
}
