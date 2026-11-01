package logql

import (
	"math"
	"math/big"
	"strconv"
	"time"
)

func splitLiteral(value string) (string, string) {
	i := len(value)
	for i > 0 && value[i-1] >= 'a' && value[i-1] <= 'z' {
		i--
	}
	return value[:i], value[i:]
}
func factor(unit string) int64 {
	switch unit {
	case "ns":
		return 1
	case "us":
		return 1000
	case "ms":
		return 1000000
	case "s":
		return 1000000000
	case "m":
		return 60 * 1000000000
	case "h":
		return 3600 * 1000000000
	case "d":
		return 86400 * 1000000000
	case "w":
		return 604800 * 1000000000
	case "b":
		return 1
	case "kb":
		return 1000
	case "mb":
		return 1000000
	case "gb":
		return 1000000000
	case "kib":
		return 1024
	case "mib":
		return 1024 * 1024
	case "gib":
		return 1024 * 1024 * 1024
	}
	return 1
}
func (p *parser) rational(at Token) *big.Rat {
	num, unit := splitLiteral(at.Lit)
	r, ok := new(big.Rat).SetString(num)
	if !ok {
		p.semantic("invalid numeric literal")
		return new(big.Rat)
	}
	r.Mul(r, new(big.Rat).SetInt64(factor(unit)))
	return r
}
func (p *parser) interval() time.Duration {
	at := p.literal()
	if at.Kind != Duration && p.err == nil {
		p.err = syntax(at, "DURATION")
	}
	if p.err != nil {
		return 0
	}
	r := p.rational(at)
	if !r.IsInt() || !r.Num().IsInt64() {
		p.semantic("duration cannot be represented in nanoseconds")
		return 0
	}
	return time.Duration(r.Num().Int64())
}
func (p *parser) window() time.Duration {
	d := p.interval()
	if d <= 0 || d > p.maxRange {
		p.semantic("range window must be positive and within maxRange")
	}
	return d
}
func (p *parser) numericValue(at Token) float64 {
	if at.Kind == Number {
		n, err := strconv.ParseFloat(at.Lit, 64)
		if err != nil || math.IsInf(n, 0) || math.IsNaN(n) || n == 0 && p.rational(at).Sign() != 0 {
			p.semantic("numeric literal is out of range")
		}
		return n
	}
	r := p.rational(at)
	if at.Kind == Duration {
		if !r.IsInt() || !r.Num().IsInt64() {
			p.semantic("duration cannot be represented in nanoseconds")
			return 0
		}
		r.Quo(r, new(big.Rat).SetInt64(1000000000))
	}
	n, _ := r.Float64()
	if math.IsInf(n, 0) || math.IsNaN(n) || n == 0 && r.Sign() != 0 {
		p.semantic("numeric literal is out of range")
	}

	return n
}
