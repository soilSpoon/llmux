import { describe, it, expect } from 'bun:test'
import { applyModelMappingV2 } from '../handlers/model-mapping'
import type { AmpModelMapping } from '../config'

describe('Model Mapping V2 (Object Support)', () => {
  it('should support string mapping (original)', () => {
    const mappings: AmpModelMapping[] = [
      { from: 'm1', to: 'target-m1:p1' }
    ]
    const result = applyModelMappingV2('m1', mappings)
    expect(result.model).toBe('target-m1')
    expect(result.provider).toBe('p1')
  })

  it('should support object mapping with thinkingLevel', () => {
    const mappings: AmpModelMapping[] = [
      { 
        from: 'm1', 
        to: { 
          model: 'target-m1', 
          provider: 'p1', 
          thinking: true,
          thinkingLevel: 'high',
        } 
      }
    ]
    const result = applyModelMappingV2('m1', mappings)
    expect(result.model).toBe('target-m1')
    expect(result.provider).toBe('p1')
    expect(result.thinking).toBe(true)
    expect(result.thinkingLevel).toBe('high')
  })

  it('should support object mapping with thinkingBudget', () => {
    const mappings: AmpModelMapping[] = [
      { 
        from: 'm1', 
        to: { 
          model: 'target-m1', 
          provider: 'p1', 
          thinking: true,
          thinkingBudget: 1000
        } 
      }
    ]
    const result = applyModelMappingV2('m1', mappings)
    expect(result.model).toBe('target-m1')
    expect(result.provider).toBe('p1')
    expect(result.thinking).toBe(true)
    expect(result.thinkingBudget).toBe(1000)
  })

  it('should inherit top-level thinking if not in object', () => {
    const mappings: AmpModelMapping[] = [
      { 
        from: 'm1', 
        to: { model: 'target-m1', provider: 'p1' },
        thinking: true
      }
    ]
    const result = applyModelMappingV2('m1', mappings)
    expect(result.thinking).toBe(true)
  })

  it('should override top-level thinking with object thinking', () => {
    const mappings: AmpModelMapping[] = [
      { 
        from: 'm1', 
        to: { model: 'target-m1', thinking: false },
        thinking: true
      }
    ]
    const result = applyModelMappingV2('m1', mappings)
    expect(result.thinking).toBe(false)
  })

  it('should support array of objects (take first)', () => {
    const mappings: AmpModelMapping[] = [
      { 
        from: 'm1', 
        to: [
          { model: 'target-m1', provider: 'p1' },
          { model: 'target-m2', provider: 'p2' }
        ]
      }
    ]
    const result = applyModelMappingV2('m1', mappings)
    expect(result.model).toBe('target-m1')
    expect(result.provider).toBe('p1')
  })
})
