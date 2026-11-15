module order {
  var paid: bool
  var shipped: bool
  var cancelled: bool
  var refunds: int

  action init = all {
    paid' = false,
    shipped' = false,
    cancelled' = false,
    refunds' = 0,
  }
  action Pay = all {
    not(paid), not(cancelled),
    paid' = true,
    shipped' = shipped, cancelled' = cancelled, refunds' = refunds,
  }
  action Ship = all {
    paid, not(shipped), not(cancelled), refunds == 0,
    shipped' = true,
    paid' = paid, cancelled' = cancelled, refunds' = refunds,
  }
  action Cancel = all {
    not(shipped), not(cancelled),
    cancelled' = true,
    refunds' = if (paid) 1 else 0,
    paid' = paid, shipped' = shipped,
  }
  action Refund = all {
    paid, not(shipped), not(cancelled), refunds == 0,
    refunds' = 1,
    paid' = paid, shipped' = shipped, cancelled' = cancelled,
  }
  action Wait = all {
    paid' = paid, shipped' = shipped, cancelled' = cancelled, refunds' = refunds,
  }
  action step = any { Pay, Ship, Cancel, Refund, Wait }
  val refundAtMostOnce = refunds <= 1
  val noRefundAfterShipping = not(shipped and refunds > 0)
  run refundTest = init.then(Pay).then(Refund).expect(refunds == 1)
}
