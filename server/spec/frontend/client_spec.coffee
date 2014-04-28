describe 'client', ->
  server    = null
  contentEl = null
  clock     = null

  beforeEach ->
    clock  = sinon.useFakeTimers()
    server = sinon.fakeServer.create()

  afterEach ->
    server.restore()
    clock.restore()
    window.reset()

  # This is an integration test esentially. TODO: see if this can be broken up
  it 'should manage widgets on the frontend', ->
    widgets = {
      foo: { id: 'foo', command: '', refreshFrequency: 1000, css: '' },
      bar: { id: 'bar', command: '', refreshFrequency: 1000, css: '' }
    }

    require '../../client.coffee'
    window.onload()

    contentEl = $('.content')
    expect(contentEl.length).toBe 1

    expect(server.requests[0].url).toEqual '/widgets'
    server.requests[0].respond(200, { "Content-Type": "application/json" }, JSON.stringify widgets)

    expect(contentEl.find('#foo').length).toBe 1
    expect(contentEl.find('#bar').length).toBe 1

    # check that widgets are started
    requestedUrls = (req.url for req in server.requests)
    expect(requestedUrls.indexOf('/widgets/foo')).not.toBe -1
    expect(requestedUrls.indexOf('/widgets/bar')).not.toBe -1

    # check that changes are requested and applied
    clock.tick()
    lastRequest = server.requests[server.requests.length-1]
    expect(lastRequest.url).toEqual '/widget-changes'

    lastRequest.respond 200, { "Content-Type": "application/json" }, JSON.stringify { foo: 'deleted' }
    expect(contentEl.find('#foo').length).toBe 0

