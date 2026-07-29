/**
 * Rebuild 'Processed Data (15mins)' from scratch.
 *
 * The rebuild itself is rebuildProcessedFromData_ in Code.js, which is the
 * same code path a Databricks delivery takes — so this menu item and the live
 * pipeline can never produce different answers from the same 'Data' tab.
 *
 * What is specific to a FORCED rebuild is the cache clearing below: the
 * properties that let the incremental path skip work are dropped first, so
 * this genuinely starts from nothing rather than trusting a stored position
 * that may be the reason someone reached for this in the first place.
 */
function forceRebuildProcessedData() {
  return withPipelineLock_('forceRebuildProcessedData', function () {
    var props = PropertiesService.getDocumentProperties();
    var scriptProps = PropertiesService.getScriptProperties();

    props.deleteProperty('PROC_A2_LAST');
    scriptProps.deleteProperty('LAST_RUN_TIMESTAMP');
    props.setProperty('DATA_LAST_ROW', '1');

    var written = rebuildProcessedFromData_();
    Logger.log('Force rebuild complete. Processed and wrote ' + written + ' rows.');
    return written;
  });
}
